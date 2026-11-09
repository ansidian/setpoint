// Triage's routes (shapes and the list in `@setpoint/shared` src/api/triage.ts): its health for the
// Unsorted line, pattern prompts and their answers, rules written and learned and
// Settings › AI. Mounted under /api behind the session, like the rest of the API.
import {patternPromptAnswerInput, RULE_WAITING, ruleInput, ruleOrderInput, ruleUpdateInput} from '@setpoint/shared';
import type {TriageStatusOut} from '@setpoint/shared';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {z} from 'zod';
import {invalid, parse} from '../errors.ts';
import type {Store} from '../store.ts';
import {triageStatus} from '../triage/health.ts';
import {historyProgress} from '../triage/history.ts';
import {aiOverview, answerPrompt, createRule, currentPrompts, deleteRule, listRules, reorderRules, updateRule} from '../triage/learning.ts';

const id = (value: string) => parse(z.coerce.number().pipe(z.int().positive()), value);
// Delete's ?waiting=cancel (D495); left out, the rule's waiting trashes run.
const ruleDeleteQuery = z.object({waiting: z.enum(RULE_WAITING).optional()});

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw invalid('The body must be JSON.');
  }
}

export function triageApi(store: Store) {
  const api = new Hono();
  api.get('/mail/triage', c => c.json({...triageStatus(store), history: historyProgress(store)} satisfies TriageStatusOut));
  api.get('/mail/prompts', c => c.json(currentPrompts(store)));
  api.post('/mail/prompts/:id', async c => c.json(answerPrompt(store, id(c.req.param('id')), parse(patternPromptAnswerInput, await body(c)).answer)));
  api.get('/mail/rules', c => c.json(listRules(store)));
  api.post('/mail/rules', async c => c.json(createRule(store, parse(ruleInput, await body(c))), 201));
  // Before /mail/rules/:id, which would otherwise take "order" for an id.
  api.put('/mail/rules/order', async c => c.json(reorderRules(store, parse(ruleOrderInput, await body(c)).rule_ids)));
  api.patch('/mail/rules/:id', async c => c.json(updateRule(store, id(c.req.param('id')), parse(ruleUpdateInput, await body(c)))));
  api.delete('/mail/rules/:id', c => {
    deleteRule(store, id(c.req.param('id')), parse(ruleDeleteQuery, c.req.query()).waiting);
    return c.body(null, 204);
  });
  api.get('/ai', c => c.json(aiOverview(store)));
  return api;
}
