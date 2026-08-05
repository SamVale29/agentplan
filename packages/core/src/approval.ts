import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ApprovalAdapter, ApprovalDecision, ApprovalRequest } from "./model.js";
import { formatPlan } from "./format.js";

export class InteractiveApprovalAdapter implements ApprovalAdapter {
  public constructor(private readonly nonInteractive = false) {}

  public async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (this.nonInteractive) {
      return { approved: false, approvedBy: "non-interactive", method: "interactive", comment: "Approval was required but interactive input is disabled." };
    }
    output.write(`${formatPlan(request.plan)}\n\nDecision required: [A] Approve all  [D] Deny  [V] View details\n`);
    const readline = createInterface({ input, output });
    try {
      const answer = (await readline.question("> ")).trim().toLowerCase();
      if (answer === "a" || answer === "approve" || answer === "y" || answer === "yes") {
        return { approved: true, approvedBy: process.env.AGENTPLAN_APPROVER ?? "local-user", method: "interactive" };
      }
      if (answer === "v" || answer === "view") {
        output.write(`${request.actions.map(formatPlanActionDetails).join("\n\n")}\n`);
        const followUp = (await readline.question("Approve all? [y/N] ")).trim().toLowerCase();
        if (followUp === "y" || followUp === "yes") {
          return { approved: true, approvedBy: process.env.AGENTPLAN_APPROVER ?? "local-user", method: "interactive" };
        }
      }
      return { approved: false, approvedBy: process.env.AGENTPLAN_APPROVER ?? "local-user", method: "interactive", comment: "Approval denied by the operator." };
    } finally {
      readline.close();
    }
  }
}

function formatPlanActionDetails(action: ApprovalRequest["actions"][number]): string {
  return `${action.id}\n${action.description ?? action.title}\nEffects: ${action.effects.join(", ") || "none"}`;
}
