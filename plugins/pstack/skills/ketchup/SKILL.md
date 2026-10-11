---
name: ketchup
description: "Catch the user up on everything in this chat since their last message, in plain words. Give each action item an executive summary with enough context to make the call. Use for /ketchup."
disable-model-invocation: true
---

# Ketchup

Invoke manually as `/pstack:ketchup` in Claude Code, or select `pstack:ketchup` or mention `$pstack:ketchup` in Codex. Do not load it implicitly.

Catch the user up on everything in this chat since the last actual human-authored message before this invocation. Exclude the invocation itself, system messages, heartbeat and scheduler prompts, automated notifications, and subagent results when choosing that anchor, even if the host presents them as user-role events. Automated events after the anchor still belong in the catch-up. If the true anchor or intervening activity cannot be established, state the gap and use only confirmed current-chat context. Do not search unrelated chats. Write in the plain voice of [`bro`](../bro/SKILL.md), and skip its restating step. Assume the user remembers their last message and nothing after it. Call each PR, branch, or agent by a name they would know, not by a label you invented during the work.

## Gather what changed

Keep this turn read-only. Collect your own work since that message, reports from subagents, and messages from anyone else in this chat. Check the current state of each PR, CI run, or agent this chat touched through existing CLI, API, or connector readers. Inspect a UI only under explicit user authorization for the current task and scope. General task authorization or an app mention does not grant it. If status requires unauthorized UI or an unavailable reader, name the concrete limitation and leave that status unchecked. Say which tasks are still running.

Do not edit files, accounts, issues, PRs, installations, model sheets, or scheduler state. Do not dispatch or resume work, start Babysit repairs, approve, merge, ship, or cancel anything.

An action item is a decision or step that still requires the user, such as a product choice, a required approval, an irreversible action they must authorize, or access you lack. Include an older unresolved decision. Omit resolved decisions and approvals already covered by the user's authorization. Work you can still do yourself is not an action item, and catching up does not authorize doing it. Report queued work as remaining, never start it in this turn.

## Write the reply

Open with one sentence that says how many action items there are, or that there are none. If nothing happened and nothing waits on the user, say so and stop.

Then say what happened, most important first. Give each result and what it means for the user. Skip steps that changed nothing. Name in one line any work left that you can do yourself.

Then give each action item a short executive summary. Cover the decision to make, why it matters now, the options and what each costs, your recommendation, and what happens if the user does not answer. If you do not know a part, say so instead of guessing. Link to the detail when there is one, and write the summary so the user can decide without opening it.
