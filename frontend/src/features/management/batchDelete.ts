/** Existing single-item APIs are the source of truth; a failed item stays retryable. */
export async function deleteSelected<Key extends string | number>(
  selected: readonly Key[],
  remove: (id: Key) => Promise<unknown>,
) {
  const ids = [...new Set(selected)]
  const settled = await Promise.allSettled(
    ids.map((id) => Promise.resolve().then(() => remove(id))),
  )
  const deleted: Key[] = []
  const failed: Array<{ id: Key; error: unknown }> = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') deleted.push(ids[index])
    else failed.push({ id: ids[index], error: result.reason })
  })
  return { deleted, failed }
}
