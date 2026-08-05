import { createAgentPlan } from "@agentplan/sdk";

const agentPlan = createAgentPlan({ configFile: "./agentplan.yaml", agentName: "example-support-agent" });

const readTicket = agentPlan.tool({
  name: "read_ticket",
  description: "Read a simulated support ticket",
  actionType: "database.read",
  mapAction(input) {
    return {
      title: `Read ticket ${input.ticketId}`,
      resource: { kind: "ticket", identifier: input.ticketId },
      input,
      effects: ["Read simulated ticket data"],
      permissions: ["database.read"],
      reversible: true
    };
  },
  async execute(input) {
    return { ticketId: input.ticketId, customer: "demo-customer", issue: "Example request", suggestedRefund: 50 };
  }
});

const refund = agentPlan.tool({
  name: "issue_simulated_refund",
  description: "Propose a refund without contacting a payment system",
  actionType: "financial.refund",
  mapAction(input) {
    return {
      title: `Simulated refund of $${input.amount}`,
      resource: { kind: "financial-operation", identifier: `refund:${input.ticketId}` },
      input,
      effects: ["Simulate a refund proposal; no payment provider is called"],
      permissions: ["financial.refund"],
      reversible: false
    };
  },
  async execute(input) {
    return { simulated: true, ticketId: input.ticketId, amount: input.amount };
  }
});

console.log("Ticket:", (await readTicket({ ticketId: "ticket_demo_1" })).result.output);
try {
  console.log("Below-limit proposal:", (await refund({ ticketId: "ticket_demo_1", amount: 50 })).result.output);
} catch (error) {
  console.log("Below-limit proposal:", error instanceof Error ? error.message : String(error));
}
try {
  await refund({ ticketId: "ticket_demo_1", amount: 150 });
} catch (error) {
  console.log("Above-limit proposal blocked:", error instanceof Error ? error.message : String(error));
}
