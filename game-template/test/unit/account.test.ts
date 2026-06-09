import { describe, expect, it } from "vitest";
import { derivationPath, faucetUrl, formatBalance } from "../../src/account";

describe("formatBalance", () => {
  it("formats whole-number balances with no decimal point", () => {
    expect(formatBalance(0n, 10)).toBe("0");
    expect(formatBalance(10n ** 10n, 10)).toBe("1"); // exactly 1 PAS
    expect(formatBalance(50n * 10n ** 10n, 10)).toBe("50");
  });

  it("formats fractional balances, trimmed to maxFrac and trailing zeros stripped", () => {
    // 1.2345678901 PAS at 10 decimals → trimmed to 4 fractional digits.
    expect(formatBalance(12_345_678_901n, 10)).toBe("1.2345");
    // Trailing zeros stripped: 1.5000000000 → "1.5".
    expect(formatBalance(15_000_000_000n, 10)).toBe("1.5");
    // Sub-unit amounts keep leading fractional zeros up to maxFrac.
    expect(formatBalance(1_000_000n, 10)).toBe("0.0001");
  });

  it("guards against non-positive decimals", () => {
    expect(formatBalance(42n, 0)).toBe("42");
  });
});

describe("faucetUrl", () => {
  it("prefills the SS58 address as the ?address= param", () => {
    expect(faucetUrl("5Grw…abc")).toBe(
      "https://faucet.dot.li/?address=5Grw%E2%80%A6abc",
    );
  });
});

describe("derivationPath", () => {
  it("renders the soft-junction path used by the host", () => {
    expect(derivationPath("arcade-snake.dot", 0)).toBe(
      "product / arcade-snake.dot / 0",
    );
  });
});
