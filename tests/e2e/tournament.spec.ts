import { test, expect } from "@playwright/test";

test("judge completes checkout, bracket, dispute, host-approved payout and receipt", async ({ page, browser, baseURL }) => {
  test.setTimeout(600000);
  await page.goto("/");
  await page.getByRole("button", { name: "Try as host" }).click();
  await expect(page).toHaveURL(/\/host$/);
  await page.locator("main").getByRole("link", { name: "New tournament", exact: true }).first().click();
  await page.getByRole("button", { name: "Open registration", exact: true }).click();
  await expect(page).toHaveURL(/\/t\/[\w-]+$/, { timeout: 180000 });
  const id = page.url().split("/").pop()!;
  await page.goto("/host");
  const playerContext = await browser.newContext({ baseURL });
  const player = await playerContext.newPage();
  await player.goto("/");
  await player.getByRole("button", { name: "Try as player" }).click();
  await expect(player).toHaveURL(/\/play$/);
  await player.goto(`/t/${id}`);
  await player.getByLabel("Gamertag (exact in-game name)").fill("JudgePlayer");
  await player.getByLabel("PayPal email (for prize payouts)").fill("test-buyer@personal.example.com");
  await player.getByRole("button", { name: "Join for $5.00" }).click();
  await expect(player).toHaveURL(/payment=paid/, { timeout: 180000 });
  await player.reload();
  await expect(player.getByText("You're in.", { exact: false })).toBeVisible();
  await playerContext.close();
  await page.goto(`/t/${id}`);
  await page.getByRole("button", { name: /Fill remaining .* slots with demo players/ }).click();
  await expect(page.getByRole("button", { name: /Submit demo results:/ }).first()).toBeVisible();
  await page.getByLabel("Demo screenshot scenario").selectOption("mismatch");
  await page.getByRole("button", { name: /Submit demo results:/ }).first().click();
  await page.getByRole("link", { name: /Resolve dispute|Review dispute|Review match/ }).first().click();
  await expect(page.getByRole("heading", { name: /Dispute:/ })).toBeVisible();
  const submittedImages = page.locator('img[alt$="submitted screenshot"]');
  await expect(submittedImages).toHaveCount(2);
  await expect.poll(() => submittedImages.first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect.poll(() => submittedImages.nth(1).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole("button", { name: / won$/ }).first().click();
  await expect(page.getByText(/Resolved. Umpra has moved/).first()).toBeVisible();
  await page.goto(`/t/${id}`);
  await page.getByLabel("Demo screenshot scenario").selectOption("agree");
  // Query the real read API to know which matches remain; exercise each submission through its UI button.
  for (let step = 0; step < 6; step++) {
    const res = await page.request.get(`/api/tournaments/${id}`);
    const data = await res.json();
    if (data.tournament.state === "confirmed") break;
    const ready = data.matches.find((m: { status: string }) => m.status === "awaiting_results");
    expect(ready).toBeTruthy();
    await page.getByRole("button", { name: `Submit demo results: ${ready.playerAGamertag} vs ${ready.playerBGamertag}`, exact: true }).click();
    await expect.poll(async () => (await (await page.request.get(`/api/tournaments/${id}`)).json()).matches.find((m: { id: string }) => m.id === ready.id).status).toBe("confirmed");
  }
  await page.goto(`/host/t/${id}/payout`);
  await expect(page.getByRole("heading", { name: /payout/i }).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm payout", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Payments cannot be recalled");
  await page.getByRole("button", { name: "Send payout", exact: true }).click();
  await expect(page.getByText(/Paid out|Paid\.|payout complete/i).first()).toBeVisible();
  await page.reload();
  const data = await (await page.request.get(`/api/tournaments/${id}`)).json();
  expect(data.tournament.state).toBe("paid");
  expect(data.prizePoolCents).toBe(500);
  expect(data.ledger.netBalanceCents).toBe(0);
  expect(data.ledger.totalPaidOutCents).toBe(500);
  for (const width of [360,768,1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
