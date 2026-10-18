/**
 * The label set that ships for agent estates. It is data in the format of any user's set (`labels:` in a
 * YAML file), loaded by the same parser. The core knows none of these names.
 */
export const AGENT_RULES_SET = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent that reads it.
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: prohibition
        description: A unit that tells the reader what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: gate
        description: A unit that sets an order, one act before another.
        atom: { kind: gate }
      - name: reply-rule
        description: A unit that sets the language, length, format, words or tone of the reader's reply.
        atom: { kind: register }
      - name: example
        description: A unit that shows a case and is not itself an instruction.
      - name: description
        description: A unit that states how something is, with no instruction.
`;
