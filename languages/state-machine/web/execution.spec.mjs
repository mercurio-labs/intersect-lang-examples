import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("nested states follow the real Run trace and an authored replacement model", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const active = page.locator("#active-state");
  const step = page.getByRole("button", { name: "Step", exact: true });
  const next = async (expected) => {
    await step.click();
    await expect(active).toHaveText(expected);
  };
  const activeNodes = page.locator(".diagram-node.execution-active");
  const leaf = page.locator(".diagram-node.execution-leaf");
  const fired = page.locator(".diagram-edge.execution-fired");
  await expect(active).toHaveText("Sealed", { timeout: 30_000 });
  await expect(page.locator(".diagram-node")).toHaveCount(6);
  await expect(page.locator(".diagram-edge")).toHaveCount(6);
  await expect(activeNodes).toHaveCount(1);
  await expect(leaf.locator(":scope > .node-body")).toHaveCSS("fill", "rgb(134, 223, 190)");
  await next("Access › Ready");
  await expect(activeNodes).toHaveCount(2);
  await expect(leaf.locator("title")).toContainText("Ready");
  await expect(fired).toHaveCount(1);
  await next("Access › Open");
  await step.click();
  await expect(page.locator("#run-status")).toContainText("no transition");
  await expect(active).toHaveText("Access › Open");
  await expect(fired).toHaveCount(0);
  await next("Access › Ready");
  await next("Fault");
  await next("Sealed");
  await expect(step).toBeDisabled();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download trace" }).click();
  const trace = JSON.parse(await readFile(await (await download).path(), "utf8"));
  expect(trace.header.format).toBe("intersect.run.trace.v1");
  expect(trace.entries.filter((entry) => entry.kind === "step_fired")).toHaveLength(5);
  await page.getByRole("button", { name: "2. open" }).click();
  await expect(active).toHaveText("Access › Open");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(active).toHaveText("Sealed");
  await expect(page.getByLabel("Trace steps").locator("li")).toHaveCount(1);
  await page.getByLabel("Send an event").selectOption("unlock");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(active).toHaveText("Access › Ready");

  const source = page.getByRole("textbox", { name: "Machine source" });
  await source.fill("machine Broken initial Missing { state Idle; }");
  await expect(step).toBeDisabled();
  await page.getByRole("button", { name: "Load model" }).click();
  await expect(page.locator("#source-status")).toContainText("analysis failed");
  await source.fill(`machine Switch initial Dormant {
    event start;
    state Dormant;
    state Engaged;
    transition Dormant on start -> Engaged;
  }`);
  await page.getByRole("button", { name: "Load model" }).click();
  await expect(active).toHaveText("Dormant");
  await expect(page.locator(".diagram-node")).toHaveCount(3);
  await page.getByLabel("Scenario events").fill("start");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(active).toHaveText("Engaged");
  expect(errors).toEqual([]);
});
