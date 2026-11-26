// ProofHub integration — placeholder for step 2 (upload) and step 3 (update).
//
// ProofHub's REST API (v3) lives at https://<company>.proofhub.com/api/v3/ and
// authenticates with an "X-API-KEY" header. The key stays on the server; the
// browser only ever talks to this app's /api/proofhub/* routes.
//
// Planned flow:
//   upload(estimationId, { projectId, taskId }) -> builds the xlsx, attaches it
//     to the chosen ProofHub item, stores { projectId, taskId, fileId, url,
//     uploadedAt } on the estimation via store.setProofhub().
//   update(estimationId) -> re-uploads using the stored link (replacing or
//     adding a new version of the attachment).

export function proofhubConfig(env = process.env) {
  const company = env.PROOFHUB_COMPANY?.trim();
  const apiKey = env.PROOFHUB_API_KEY?.trim();
  return {
    configured: Boolean(company && apiKey),
    baseUrl: company ? `https://${company}.proofhub.com/api/v3` : null,
    apiKey,
  };
}

export class NotImplementedError extends Error {
  status = 501;
}

export async function uploadEstimation() {
  throw new NotImplementedError('ProofHub upload is not implemented yet (planned for step 2).');
}

export async function updateEstimation() {
  throw new NotImplementedError('ProofHub update is not implemented yet (planned for step 3).');
}
