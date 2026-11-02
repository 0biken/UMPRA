import { testOverrides } from "@/server/test-overrides";
import { AppError } from "@/lib/errors";
import { fromPayPalAmount, toPayPalAmount } from "@/lib/money";
import { env } from "@/server/env";

export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export interface CreateOrderInput {
  entryId: string;
  tournamentTitle: string;
  amountCents: number;
  returnUrl: string;
  cancelUrl: string;
  requestId: string;
}

export interface CreateOrderResult {
  orderId: string;
  status: string;
  approveUrl: string;
}

export interface OrderDetails {
  id: string;
  status: string;
  customId: string | null;
  referenceId: string | null;
  amountCents: number;
  currencyCode: string;
  captureId: string | null;
}

export interface CaptureOrderResult {
  orderId: string;
  captureId: string;
  status: string;
  amountCents: number;
}

export interface RefundCaptureResult {
  refundId: string;
  status: string;
}

export interface PayoutBatchItemInput {
  senderItemId: string;
  receiverEmail: string;
  amountCents: number;
  note: string;
}

export interface CreatePayoutBatchInput {
  senderBatchId: string;
  emailSubject: string;
  emailMessage: string;
  items: PayoutBatchItemInput[];
}

export interface CreatePayoutBatchResult {
  batchId: string;
  batchStatus: string;
}

export interface PayoutBatchItemStatus {
  payoutItemId: string;
  senderItemId: string;
  transactionStatus: string;
  amountCents: number;
  receiver: string;
  errorMessage: string | null;
}

export interface PayoutBatchDetails {
  batchId: string;
  batchStatus: string;
  items: PayoutBatchItemStatus[];
}

export interface VerifyWebhookSignatureInput {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
  webhookId: string;
  webhookEvent: unknown;
}

export interface PayPalClient {
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  getOrder(orderId: string): Promise<OrderDetails>;
  captureOrder(orderId: string, requestId: string): Promise<CaptureOrderResult>;
  refundCapture(captureId: string, requestId: string): Promise<RefundCaptureResult>;
  createPayoutBatch(input: CreatePayoutBatchInput): Promise<CreatePayoutBatchResult>;
  getPayoutBatch(batchId: string): Promise<PayoutBatchDetails>;
  verifyWebhookSignature(input: VerifyWebhookSignatureInput): Promise<boolean>;
}

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

export class HttpPayPalClient implements PayPalClient {
  private tokenCache: TokenCache | null = null;
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly nowFn: () => number;

  constructor(options?: {
    baseUrl?: string;
    clientId?: string;
    clientSecret?: string;
    fetchImpl?: typeof fetch;
    nowFn?: () => number;
  }) {
    if (env.PAYPAL_ENV !== "sandbox") {
      throw new AppError(
        "PAYPAL_ERROR",
        "PayPal client only supports sandbox environment.",
        500
      );
    }
    this.baseUrl = options?.baseUrl ?? PAYPAL_SANDBOX_BASE_URL;
    this.clientId = options?.clientId ?? env.PAYPAL_CLIENT_ID;
    this.clientSecret = options?.clientSecret ?? env.PAYPAL_CLIENT_SECRET;
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.nowFn = options?.nowFn ?? (() => Date.now());
  }

  public async getAccessToken(): Promise<string> {
    const now = this.nowFn();
    // Refresh 60 seconds before expiry
    if (this.tokenCache && now < this.tokenCache.expiresAtMs - 60_000) {
      return this.tokenCache.accessToken;
    }

    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`
    ).toString("base64");

    const res = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    const debugId = res.headers.get("paypal-debug-id");
    if (!res.ok) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "PayPal OAuth token request failed",
          status: res.status,
          paypalDebugId: debugId,
        })
      );
      throw new AppError(
        "PAYPAL_ERROR",
        "Could not connect to PayPal sandbox. Try again in a moment.",
        502,
        { paypalDebugId: debugId, status: res.status }
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.tokenCache = {
      accessToken: data.access_token,
      expiresAtMs: now + (data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
  }

  public async request<T>(
    method: "GET" | "POST",
    path: string,
    options?: {
      body?: unknown;
      requestId?: string;
    }
  ): Promise<T> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (options?.requestId) {
      headers["PayPal-Request-Id"] = options.requestId;
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body:
        options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const debugId = res.headers.get("paypal-debug-id");
    if (!res.ok) {
      let errorSummary = `HTTP ${res.status}`;
      try {
        const errBody = (await res.json()) as {
          name?: string;
          message?: string;
        };
        if (errBody?.name || errBody?.message) {
          errorSummary = `${errBody.name ?? "ERROR"}: ${errBody.message ?? ""}`;
        }
      } catch {
        // ignore JSON parse failure on error body
      }

      console.error(
        JSON.stringify({
          level: "error",
          msg: "PayPal API call failed",
          method,
          path,
          status: res.status,
          paypalDebugId: debugId,
          errorSummary,
        })
      );

      throw new AppError(
        "PAYPAL_ERROR",
        `PayPal sandbox returned an error (${errorSummary}). Try again.`,
        502,
        { paypalDebugId: debugId, status: res.status }
      );
    }

    return (await res.json()) as T;
  }

  public async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const amountValue = toPayPalAmount(input.amountCents);
    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.entryId,
          custom_id: input.entryId,
          description: `Umpra entry: ${input.tournamentTitle}`.slice(0, 127),
          amount: {
            currency_code: "USD",
            value: amountValue,
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
          },
        },
      },
    };

    const data = await this.request<{
      id: string;
      status: string;
      links?: Array<{ href: string; rel: string }>;
    }>("POST", "/v2/checkout/orders", {
      body,
      requestId: input.requestId,
    });

    const approveLink =
      data.links?.find((l) => l.rel === "payer-action") ??
      data.links?.find((l) => l.rel === "approve");

    if (!approveLink?.href) {
      throw new AppError(
        "PAYPAL_ERROR",
        "PayPal order did not include a buyer approval link.",
        502
      );
    }

    return {
      orderId: data.id,
      status: data.status,
      approveUrl: approveLink.href,
    };
  }

  public async getOrder(orderId: string): Promise<OrderDetails> {
    const data = await this.request<{
      id: string;
      status: string;
      purchase_units?: Array<{
        reference_id?: string;
        custom_id?: string;
        amount?: { currency_code?: string; value?: string };
        payments?: {
          captures?: Array<{ id?: string; status?: string }>;
        };
      }>;
    }>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);

    const unit = data.purchase_units?.[0];
    const amountCents = unit?.amount?.value
      ? fromPayPalAmount(unit.amount.value)
      : 0;
    const captureId = unit?.payments?.captures?.[0]?.id ?? null;

    return {
      id: data.id,
      status: data.status,
      customId: unit?.custom_id ?? unit?.reference_id ?? null,
      referenceId: unit?.reference_id ?? null,
      amountCents,
      currencyCode: unit?.amount?.currency_code ?? "USD",
      captureId,
    };
  }

  public async captureOrder(
    orderId: string,
    requestId: string
  ): Promise<CaptureOrderResult> {
    const data = await this.request<{
      id: string;
      status: string;
      purchase_units?: Array<{
        payments?: {
          captures?: Array<{
            id: string;
            status: string;
            amount?: { value?: string };
          }>;
        };
      }>;
    }>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      body: {},
      requestId,
    });

    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture?.id) {
      throw new AppError(
        "PAYPAL_ERROR",
        "PayPal capture response did not contain a capture ID.",
        502
      );
    }

    const amountCents = capture.amount?.value
      ? fromPayPalAmount(capture.amount.value)
      : 0;

    return {
      orderId: data.id,
      captureId: capture.id,
      status: capture.status ?? data.status,
      amountCents,
    };
  }

  public async refundCapture(
    captureId: string,
    requestId: string
  ): Promise<RefundCaptureResult> {
    const data = await this.request<{
      id: string;
      status: string;
    }>(
      "POST",
      `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      {
        body: {},
        requestId,
      }
    );

    return {
      refundId: data.id,
      status: data.status,
    };
  }

  public async createPayoutBatch(
    input: CreatePayoutBatchInput
  ): Promise<CreatePayoutBatchResult> {
    const body = {
      sender_batch_header: {
        sender_batch_id: input.senderBatchId,
        recipient_type: "EMAIL",
        email_subject: input.emailSubject,
        email_message: input.emailMessage,
      },
      items: input.items.map((item) => ({
        amount: {
          value: toPayPalAmount(item.amountCents),
          currency: "USD",
        },
        sender_item_id: item.senderItemId,
        recipient_wallet: "PAYPAL",
        receiver: item.receiverEmail,
        note: item.note,
      })),
    };

    const data = await this.request<{
      batch_header: {
        payout_batch_id: string;
        batch_status: string;
      };
    }>("POST", "/v1/payments/payouts", {
      body,
    });

    return {
      batchId: data.batch_header.payout_batch_id,
      batchStatus: data.batch_header.batch_status,
    };
  }

  public async getPayoutBatch(batchId: string): Promise<PayoutBatchDetails> {
    const data = await this.request<{
      batch_header: {
        payout_batch_id: string;
        batch_status: string;
      };
      items?: Array<{
        payout_item_id: string;
        transaction_status: string;
        payout_item: {
          sender_item_id: string;
          receiver: string;
          amount: { value: string; currency: string };
        };
        errors?: { name?: string; message?: string };
      }>;
    }>("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`);

    return {
      batchId: data.batch_header.payout_batch_id,
      batchStatus: data.batch_header.batch_status,
      items: (data.items ?? []).map((it) => ({
        payoutItemId: it.payout_item_id,
        senderItemId: it.payout_item.sender_item_id,
        transactionStatus: it.transaction_status,
        amountCents: fromPayPalAmount(it.payout_item.amount.value),
        receiver: it.payout_item.receiver,
        errorMessage: it.errors?.message ?? it.errors?.name ?? null,
      })),
    };
  }

  public async verifyWebhookSignature(
    input: VerifyWebhookSignatureInput
  ): Promise<boolean> {
    const data = await this.request<{
      verification_status?: string;
    }>("POST", "/v1/notifications/verify-webhook-signature", {
      body: {
        auth_algo: input.authAlgo,
        cert_url: input.certUrl,
        transmission_id: input.transmissionId,
        transmission_sig: input.transmissionSig,
        transmission_time: input.transmissionTime,
        webhook_id: input.webhookId,
        webhook_event: input.webhookEvent,
      },
    });
    return data.verification_status === "SUCCESS";
  }
}

let activePayPalClient: PayPalClient | null = null;

export function getPayPalClient(): PayPalClient {
  const override = testOverrides()?.paypal;
  if (override) return override;
  if (!activePayPalClient) {
    activePayPalClient = new HttpPayPalClient();
  }
  return activePayPalClient;
}

export function setPayPalClient(client: PayPalClient | null): void {
  activePayPalClient = client;
}
