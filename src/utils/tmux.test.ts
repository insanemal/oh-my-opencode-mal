import { describe, expect, test, beforeEach } from "bun:test";
import { isInsideTmux, resetServerCheck } from "./tmux";

describe("tmux utils", () => {
    describe("isInsideTmux", () => {
        const originalTmux = process.env.TMUX;

        beforeEach(() => {
            // Reset to original state
            if (originalTmux) {
                process.env.TMUX = originalTmux;
            } else {
                delete process.env.TMUX;
            }
        });

        test("returns true when TMUX env var is set", () => {
            process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
            expect(isInsideTmux()).toBe(true);
        });

        test("returns false when TMUX env var is not set", () => {
            delete process.env.TMUX;
            expect(isInsideTmux()).toBe(false);
        });

        test("returns false when TMUX env var is empty string", () => {
            process.env.TMUX = "";
            expect(isInsideTmux()).toBe(false);
        });

        test("returns true for any non-empty TMUX value", () => {
            process.env.TMUX = "any-value";
            expect(isInsideTmux()).toBe(true);
        });
    });

    describe("resetServerCheck", () => {
        test("resetServerCheck is exported and is a function", () => {
            expect(typeof resetServerCheck).toBe("function");
        });

        test("resetServerCheck does not throw", () => {
            expect(() => resetServerCheck()).not.toThrow();
        });

        test("can be called multiple times", () => {
            expect(() => {
                resetServerCheck();
                resetServerCheck();
                resetServerCheck();
            }).not.toThrow();
        });
    });

    // Note: Testing getTmuxPath, spawnTmuxPane, and closeTmuxPane requires:
    // 1. Mocking Bun's spawn function
    // 2. Mocking file system operations
    // 3. Running in a tmux environment
    // 4. Mocking HTTP fetch for server checks
    //
    // These are better suited for integration tests rather than unit tests.
    // The current tests cover the simple, pure functions that don't require mocking.
});
