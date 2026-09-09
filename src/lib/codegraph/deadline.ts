/** Late reads may finish, but an expired operation must not publish a context pack. */
export async function contextDeadline<T>(run: (signal: AbortSignal) => Promise<T>, milliseconds = 5000): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([run(controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Code context deadline exceeded')); }, milliseconds);
    })]);
  } finally { clearTimeout(timer!); }
}
