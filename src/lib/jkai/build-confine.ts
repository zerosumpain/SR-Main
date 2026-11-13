/**
 * Landlock confinement for the BUILD LANE's host-mode commands.
 *
 * In host mode the builder sidecar runs agent-authored code as its own account,
 * and that account also runs other long-lived services on the box. Two things
 * follow that the systemd unit cannot fix on its own:
 *
 *   1. Same account means same-uid `/proc/<pid>/environ` (and ptrace). Every
 *      process the account owns — the sidecar itself, which holds the
 *      orchestrator's credentials, and every unrelated service — was readable
 *      from a build command. `ProtectProc=invisible` only hides OTHER users.
 *   2. Unit-level `IPAddressDeny=` is address-granular, and the orchestrator
 *      and the gate both legitimately need loopback (Postgres, the web app's
 *      tool bridge), so it cannot single out the unauthenticated loopback
 *      services a build has no business calling.
 *
 * Landlock answers both per process tree, unprivileged, without a second
 * account or a namespace (a PID namespace per command would kill the
 * background preview servers the build lane starts with `nohup … &`):
 *
 *   - Entering ANY Landlock domain applies its ptrace rule: a confined process
 *     can only inspect processes in its own domain or one nested inside it, so
 *     `/proc/<pid>/environ|mem` of the sidecar and of every other service of
 *     the account return EACCES. Signals are NOT scoped, so `kill $(cat pid)`
 *     between commands still works.
 *   - The net ruleset handles TCP connect and allows every port except
 *     DENIED_TCP_PORTS. Landlock net rules are allow-lists, hence one rule per
 *     port; ~0.15s per command, measured, against commands that run for
 *     seconds to minutes.
 *
 * The filesystem access handled is mknod of block devices only, which nothing
 * in a build needs; it exists because a domain must handle *something*.
 *
 * FAILS CLOSED: a kernel without Landlock net support (ABI < 4) makes the
 * helper exit 126 and the command fail with the reason, rather than run
 * unconfined.
 *
 * Python because it is on every host that runs builds and needs no compiler;
 * stdlib only, run with `-I` so nothing from the workspace can be imported.
 */

/** Loopback services with no credential of their own that builds must not reach. */
export const DENIED_TCP_PORTS: readonly number[] = [
  3110, // WhatsApp worker — sends as the owner
  5207, // Codex bridge — spends the owner's subscription
];

/** Exit status the helper uses when it cannot confine; never a command's own. */
export const CONFINE_UNAVAILABLE_EXIT = 126;

const CONFINE_SOURCE = String.raw`
import ctypes, os, struct, sys
libc = ctypes.CDLL(None, use_errno=True)
sc = libc.syscall
sc.restype = ctypes.c_long
def die(msg):
    sys.stderr.write('build confinement unavailable: ' + msg + '\n')
    os._exit(126)
deny = {int(p) for p in sys.argv[1].split(',') if p}
argv = sys.argv[2:]
if not argv: die('no command')
abi = sc(444, None, 0, 1)
if abi < 4: die('Landlock network rules need ABI 4 (kernel reports %d)' % abi)
attr = ctypes.create_string_buffer(struct.pack('QQ', 1 << 11, 1 << 1))
fd = sc(444, attr, 16, 0)
if fd < 0: die('landlock_create_ruleset errno %d' % ctypes.get_errno())
rule = (ctypes.c_uint64 * 2)(2, 0)
ref = ctypes.byref(rule)
for port in range(65536):
    if port in deny: continue
    rule[1] = port
    if sc(445, fd, 2, ref, 0) != 0: die('landlock_add_rule errno %d' % ctypes.get_errno())
if libc.prctl(38, 1, 0, 0, 0) != 0: die('no_new_privs errno %d' % ctypes.get_errno())
if sc(446, fd, 0) != 0: die('landlock_restrict_self errno %d' % ctypes.get_errno())
os.close(fd)
try:
    os.execvp(argv[0], argv)
except OSError as e:
    sys.stderr.write('%s: %s\n' % (argv[0], e.strerror))
    os._exit(127)
`;

/**
 * argv that runs `command` (an argv itself) inside the build confinement.
 * Spawn it without a shell: `['python3', ...confinedArgs(['bash', '-c', cmd])]`.
 */
export function confinedArgs(command: string[], deny: readonly number[] = DENIED_TCP_PORTS): string[] {
  if (command.length === 0) throw new Error('confinedArgs: empty command');
  return ['-I', '-c', CONFINE_SOURCE, deny.join(','), ...command];
}

export const CONFINE_INTERPRETER = 'python3';

/**
 * Whether host-mode commands from THIS process are confined. Only the builder
 * sidecar runs agent code with write access to workspaces; the web app's
 * host-lane calls run as a separate account that can only read them, and are
 * on interactive request paths where the per-command cost would show.
 */
export function buildConfinementEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JKAI_BUILDS_HOSTMODE === '1' && env.JKAI_BUILDER_PROCESS === '1';
}
