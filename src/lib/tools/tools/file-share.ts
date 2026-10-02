// `file_share_link` — turn a drive file the agent produced into a link that
// works without a session.
//
// The interesting constraint is what this tool CANNOT do. The drive holds 56
// files the owner uploaded by hand alongside anything an agent writes, and a
// tool that takes a file id and returns a public URL is, unrestricted, a way to
// exfiltrate any of them: a prompt-injected model does not need to read a bank
// statement if it can publish one. So minting is refused for anything whose
// `uploadedBy` is not a known agent tag (see AGENT_UPLOADERS in
// $lib/file-shares). Human uploads are recorded under an email address and can
// never match, and the check fails closed on an unrecognised or null uploader.
//
// The owner is not restricted this way — sharing any file from /drive goes
// through POST /api/files/shares, which is behind the owner gate.

import { register } from '../registry-internal';
import { assertAgentMayShare, createFileShare, SHARE_TTL_DAYS } from '$lib/file-shares';

register({
  name: 'file_share_link',
  // Publishing bytes to an anonymous URL is a real-world side effect, so it
  // goes through the same confirmation gate as the other destructive tools.
  destructive: true,
  description:
    `Create a download link for a drive file YOU created, shareable with someone who has no login. ` +
    `The link expires after ${SHARE_TTL_DAYS} days and John can revoke it from /drive. ` +
    'Only works on agent-created files — ask John to share anything he uploaded himself. ' +
    'Returns the URL once; it cannot be looked up again afterwards.',
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'Drive file id, from file_list.' },
      label: { type: 'string', description: 'Short note on who or what the link is for, shown in the revocation list.' },
    },
    required: ['fileId'],
  },
  category: 'Files',
  toolset: 'files',
  handler: async (args) => {
    const fileId = String(args.fileId ?? '').trim();
    if (!fileId) return { success: false, error: 'fileId is required' };

    try {
      await assertAgentMayShare(fileId);
      const share = await createFileShare({
        fileId,
        createdBy: 'jkai',
        label: args.label ? String(args.label) : null,
      });
      return {
        success: true,
        data: {
          url: share.url,
          name: share.name,
          expiresAt: share.expiresAt.toISOString(),
          note: `expires in ${SHARE_TTL_DAYS} days; revocable at /drive`,
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'could not create share link' };
    }
  },
});
