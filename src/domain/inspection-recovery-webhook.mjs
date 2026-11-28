import {applyRecoveryDelivery, createRecoverySession} from './inspection-recovery.mjs';
import {createInspectionHttpServer} from './inspection-webhook.mjs';

export function createInspectionRecoveryWebhook() {
  const session = createRecoverySession();
  return createInspectionHttpServer({
    receipt:() => ({equipment:session.equipment, history:session.history, attempts:session.attempts}),
    receive(event, headers) {
      const fault = headers['x-practice-fault'] ?? 'none';
      const attempt = applyRecoveryDelivery(session, event, fault);
      // The receiver has already committed. Close the connection before writing any response.
      if (attempt.result === 'response_lost') return null;
      const status = attempt.result === 'failed_before_commit' ? 503 : 200;
      return {status, body:{result:attempt.result}};
    },
  });
}
