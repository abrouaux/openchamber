import { describe, expect, test } from "bun:test"
import type { Message, Session } from "@opencode-ai/sdk/v2/client"
import { commitRevertedCost, computeRevertedBranchCost, readRevertedCost } from "./reverted-cost-ledger"

const assistant = (id: string, cost: number): Message => ({ id, role: "assistant", cost }) as Message

describe("reverted cost ledger", () => {
    test("accumulates committed reverted branches without decreasing", () => {
        const directory = `/ledger-${Date.now()}`
        const sessionID = "session-1"
        commitRevertedCost(directory, sessionID, 0.5, "test-runtime")
        commitRevertedCost(directory, sessionID, 0.25, "test-runtime")
        expect(readRevertedCost(directory, sessionID, "test-runtime")).toBe(0.75)
    })

    test("includes the reverted message tail and descendants created after it", () => {
        const root = {
            id: "root",
            revert: { messageID: "msg_2" },
            time: { created: 1 },
        } as Session
        const child = { id: "child", parentID: "root", time: { created: 3 } } as Session
        expect(computeRevertedBranchCost({
            rootID: "root",
            sessions: [root, child],
            messages: {
                root: [
                    { ...assistant("msg_1", 1), time: { created: 1 } },
                    { ...assistant("msg_2", 0.5), time: { created: 2 } },
                ],
                child: [assistant("child_1", 0.25)],
            },
            statuses: {},
        })).toBe(0.75)
    })
})
