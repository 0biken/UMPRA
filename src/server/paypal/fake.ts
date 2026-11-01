import { AppError } from "@/lib/errors";
import type {
  CaptureOrderResult,
  CreateOrderInput,
  CreateOrderResult,
  CreatePayoutBatchInput,
  CreatePayoutBatchResult,
  OrderDetails,
  PayPalClient,
  PayoutBatchDetails,
  PayoutBatchItemStatus,
  RefundCaptureResult,
  VerifyWebhookSignatureInput,
} from "./client";

interface StoredOrder extends OrderDetails {
  approveUrl: string;
  requestId: string;
}

interface StoredCapture extends CaptureOrderResult {
  requestId: string;
}

interface StoredRefund extends RefundCaptureResult {
  captureId: string;
  requestId: string;
}

interface StoredBatch extends PayoutBatchDetails {
  senderBatchId: string;
}

/**
 * In-memory test double for PayPalClient per `08 §Test doubles`.
 * Honors `PayPal-Request-Id` and `sender_batch_id` idempotency exactly like PayPal sandbox.
 */
export class FakePayPal implements PayPalClient {
  private ordersById = new Map<string, StoredOrder>();
  private ordersByRequestId = new Map<string, StoredOrder>();
  private capturesByRequestId = new Map<string, StoredCapture>();
  private capturesByOrderId = new Map<string, StoredCapture>();
  private refundsByRequestId = new Map<string, StoredRefund>();
  private batchesById = new Map<string, StoredBatch>();
  private batchesBySenderId = new Map<string, StoredBatch>();

  private nextFailureByOp = new Map<string, AppError>();
  private webhookSignatureValid = true;
  private seq = 1;

  public createOrderCalls = 0;
  public captureOrderCalls = 0;
  public refundCaptureCalls = 0;
  public createPayoutBatchCalls = 0;

  private nextId(prefix: string): string {
    return `${prefix}-${this.seq++}`;
  }

  public failNext(
    op:
      | "createOrder"
      | "getOrder"
      | "captureOrder"
      | "refundCapture"
      | "createPayoutBatch"
      | "getPayoutBatch",
    error = new AppError("PAYPAL_ERROR", `Simulated PayPal ${op} failure`, 502)
  ): void {
    this.nextFailureByOp.set(op, error);
  }

  private checkFailure(op: string): void {
    const err = this.nextFailureByOp.get(op);
    if (err) {
      this.nextFailureByOp.delete(op);
      throw err;
    }
  }

  public setWebhookSignatureValid(valid: boolean): void {
    this.webhookSignatureValid = valid;
  }

  /**
   * Simulates the buyer approving the order on PayPal's checkout page.
   * Allows overriding amountCents or customId to test EC-P10 tampering.
   */
  public approveOrder(
    orderId: string,
    overrides?: { amountCents?: number; customId?: string; status?: string }
  ): void {
    const order = this.ordersById.get(orderId);
    if (!order) {
      throw new Error(`FakePayPal: order ${orderId} not found`);
    }
    order.status = overrides?.status ?? "APPROVED";
    if (overrides?.amountCents !== undefined) {
      order.amountCents = overrides.amountCents;
    }
    if (overrides?.customId !== undefined) {
      order.customId = overrides.customId;
    }
  }

  /**
   * Updates a payout item status inside a batch (e.g. SUCCESS, FAILED, UNCLAIMED).
   */
  public setPayoutItemOutcome(
    senderItemId: string,
    transactionStatus: "SUCCESS" | "FAILED" | "UNCLAIMED" | "PENDING",
    errorMessage: string | null = null
  ): void {
    for (const batch of this.batchesById.values()) {
      const item = batch.items.find((i) => i.senderItemId === senderItemId);
      if (item) {
        item.transactionStatus = transactionStatus;
        item.errorMessage = errorMessage;
        const allSucceeded = batch.items.every(
          (i) => i.transactionStatus === "SUCCESS"
        );
        batch.batchStatus = allSucceeded ? "SUCCESS" : "PROCESSING";
      }
    }
  }

  public async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    this.createOrderCalls += 1;
    this.checkFailure("createOrder");

    const existing = this.ordersByRequestId.get(input.requestId);
    if (existing) {
      return {
        orderId: existing.id,
        status: existing.status,
        approveUrl: existing.approveUrl,
      };
    }

    const orderId = this.nextId("ORDER");
    const approveUrl = `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`;
    const stored: StoredOrder = {
      id: orderId,
      status: "PAYER_ACTION_REQUIRED",
      customId: input.entryId,
      referenceId: input.entryId,
      amountCents: input.amountCents,
      currencyCode: "USD",
      captureId: null,
      approveUrl,
      requestId: input.requestId,
    };

    this.ordersById.set(orderId, stored);
    this.ordersByRequestId.set(input.requestId, stored);

    return {
      orderId,
      status: stored.status,
      approveUrl,
    };
  }

  public async getOrder(orderId: string): Promise<OrderDetails> {
    this.checkFailure("getOrder");
    const order = this.ordersById.get(orderId);
    if (!order) {
      throw new AppError("PAYPAL_ERROR", `Order ${orderId} not found`, 404);
    }
    return {
      id: order.id,
      status: order.status,
      customId: order.customId,
      referenceId: order.referenceId,
      amountCents: order.amountCents,
      currencyCode: order.currencyCode,
      captureId: order.captureId,
    };
  }

  public async captureOrder(
    orderId: string,
    requestId: string
  ): Promise<CaptureOrderResult> {
    this.captureOrderCalls += 1;
    this.checkFailure("captureOrder");

    const byReq = this.capturesByRequestId.get(requestId);
    if (byReq) {
      return {
        orderId: byReq.orderId,
        captureId: byReq.captureId,
        status: byReq.status,
        amountCents: byReq.amountCents,
      };
    }

    const order = this.ordersById.get(orderId);
    if (!order) {
      throw new AppError("PAYPAL_ERROR", `Order ${orderId} not found`, 404);
    }
    if (order.status !== "APPROVED" && order.status !== "COMPLETED") {
      throw new AppError(
        "PAYMENT_FAILED",
        `Order ${orderId} is not approved (status: ${order.status}).`,
        400
      );
    }

    const existingForOrder = this.capturesByOrderId.get(orderId);
    if (existingForOrder) {
      return existingForOrder;
    }

    const captureId = this.nextId("CAP");
    const capture: StoredCapture = {
      orderId,
      captureId,
      status: "COMPLETED",
      amountCents: order.amountCents,
      requestId,
    };

    order.status = "COMPLETED";
    order.captureId = captureId;
    this.capturesByRequestId.set(requestId, capture);
    this.capturesByOrderId.set(orderId, capture);

    return {
      orderId: capture.orderId,
      captureId: capture.captureId,
      status: capture.status,
      amountCents: capture.amountCents,
    };
  }

  public async refundCapture(
    captureId: string,
    requestId: string
  ): Promise<RefundCaptureResult> {
    this.refundCaptureCalls += 1;
    this.checkFailure("refundCapture");

    const existing = this.refundsByRequestId.get(requestId);
    if (existing) {
      return {
        refundId: existing.refundId,
        status: existing.status,
      };
    }

    const refundId = this.nextId("REF");
    const stored: StoredRefund = {
      refundId,
      status: "COMPLETED",
      captureId,
      requestId,
    };
    this.refundsByRequestId.set(requestId, stored);

    return {
      refundId,
      status: stored.status,
    };
  }

  public async createPayoutBatch(
    input: CreatePayoutBatchInput
  ): Promise<CreatePayoutBatchResult> {
    this.createPayoutBatchCalls += 1;
    this.checkFailure("createPayoutBatch");

    const existing = this.batchesBySenderId.get(input.senderBatchId);
    if (existing) {
      return {
        batchId: existing.batchId,
        batchStatus: existing.batchStatus,
      };
    }

    const batchId = this.nextId("BATCH");
    const items: PayoutBatchItemStatus[] = input.items.map((it) => ({
      payoutItemId: this.nextId("PITEM"),
      senderItemId: it.senderItemId,
      transactionStatus: "SUCCESS",
      amountCents: it.amountCents,
      receiver: it.receiverEmail,
      errorMessage: null,
    }));

    const stored: StoredBatch = {
      batchId,
      batchStatus: "SUCCESS",
      senderBatchId: input.senderBatchId,
      items,
    };

    this.batchesById.set(batchId, stored);
    this.batchesBySenderId.set(input.senderBatchId, stored);

    return {
      batchId,
      batchStatus: stored.batchStatus,
    };
  }

  public async getPayoutBatch(batchId: string): Promise<PayoutBatchDetails> {
    this.checkFailure("getPayoutBatch");
    const batch = this.batchesById.get(batchId);
    if (!batch) {
      throw new AppError("PAYPAL_ERROR", `Payout batch ${batchId} not found`, 404);
    }
    return {
      batchId: batch.batchId,
      batchStatus: batch.batchStatus,
      items: batch.items.map((i) => ({ ...i })),
    };
  }

  public async verifyWebhookSignature(
    input: VerifyWebhookSignatureInput
  ): Promise<boolean> {
    return Boolean(input.webhookId) && this.webhookSignatureValid;
  }
}
