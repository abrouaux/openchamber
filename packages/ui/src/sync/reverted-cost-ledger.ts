import type { Message, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { computeSessionCostAndCounts } from "@/stores/utils/tokenUtils"
import { getRuntimeKey } from "@/lib/runtime-switch"
import { computeSubtreeIds } from "./scoped-blocking-requests"

const STORAGE_PREFIX = "oc.reverted-cost.v1"
const memoryCosts = new Map<string, number>()

const hash = (value: string): string => {
    let result = 0
    for (let index = 0; index < value.length; index += 1) {
        result = ((result << 5) - result) + value.charCodeAt(index)
        result |= 0
    }
    return Math.abs(result).toString(36)
}

const costKey = (runtimeKey: string, directory: string, sessionID: string): string =>
    `${runtimeKey}\n${directory}\n${sessionID}`

const storageKey = (runtimeKey: string, directory: string, sessionID: string): string =>
    `${STORAGE_PREFIX}.${hash(costKey(runtimeKey, directory, sessionID))}`

const readStoredCost = (runtimeKey: string, directory: string, sessionID: string): number => {
    if (typeof localStorage === "undefined") return 0
    try {
        const raw = localStorage.getItem(storageKey(runtimeKey, directory, sessionID))
        if (!raw) return 0
        const parsed = JSON.parse(raw) as { version?: unknown; cost?: unknown }
        return parsed.version === 1 && typeof parsed.cost === "number" && Number.isFinite(parsed.cost) && parsed.cost > 0
            ? parsed.cost
            : 0
    } catch {
        return 0
    }
}

export const readRevertedCost = (directory: string, sessionID: string, runtimeKey = getRuntimeKey()): number => {
    const key = costKey(runtimeKey, directory, sessionID)
    const cached = memoryCosts.get(key)
    if (cached !== undefined) return cached
    const cost = readStoredCost(runtimeKey, directory, sessionID)
    memoryCosts.set(key, cost)
    return cost
}

export const commitRevertedCost = (directory: string, sessionID: string, cost: number, runtimeKey = getRuntimeKey()): void => {
    if (!Number.isFinite(cost) || cost <= 0) return
    const next = readRevertedCost(directory, sessionID, runtimeKey) + cost
    memoryCosts.set(costKey(runtimeKey, directory, sessionID), next)
    if (typeof localStorage === "undefined") return
    try {
        localStorage.setItem(storageKey(runtimeKey, directory, sessionID), JSON.stringify({ version: 1, cost: next }))
    } catch {
        // Keep the in-memory total if persistence is temporarily unavailable.
    }
}

export const deleteRevertedCost = (directory: string, sessionID: string, runtimeKey = getRuntimeKey()): void => {
    memoryCosts.delete(costKey(runtimeKey, directory, sessionID))
    if (typeof localStorage === "undefined") return
    try {
        localStorage.removeItem(storageKey(runtimeKey, directory, sessionID))
    } catch {
        // Session deletion must not fail because browser storage is unavailable.
    }
}

export const computeRevertedBranchCost = (input: {
    rootID: string
    sessions: Session[]
    messages: Record<string, Message[] | undefined>
    statuses: Record<string, SessionStatus | undefined>
}): number => {
    const root = input.sessions.find((session) => session.id === input.rootID)
    const revertMessageID = root?.revert?.messageID
    if (!revertMessageID) return 0

    const ids = computeSubtreeIds(input.sessions, input.rootID)
    const rootMessages = input.messages[input.rootID] ?? []
    const revertTime = rootMessages.find((message) => message.id === revertMessageID)?.time?.created
    let total = computeSessionCostAndCounts(rootMessages.filter((message) => message.id >= revertMessageID)).totalCost

    for (const sessionID of ids) {
        if (sessionID === input.rootID) continue
        const session = input.sessions.find((candidate) => candidate.id === sessionID)
        if (revertTime !== undefined && session?.time?.created !== undefined && session.time.created < revertTime) continue
        const messages = input.messages[sessionID]
        if (messages) total += computeSessionCostAndCounts(messages).totalCost
    }
    return total
}
