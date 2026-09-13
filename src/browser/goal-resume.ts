type GoalManager = {
  getStreamRole(threadId: string): {role: string} | undefined;
  startEmptyTurn(threadId: string, options: Record<string, never>): Promise<unknown>;
};

// Goal metadata is shared on disk, but the continuation scheduler belongs to
// the engine that owns the task. The desktop's normal empty-turn path forwards
// to that owner and already checks whether a turn is active before starting one.
export async function resumeFollowerGoal(
  manager: GoalManager,
  threadId: string,
  status: string,
): Promise<void> {
  if (status !== 'active' || manager.getStreamRole(threadId)?.role !== 'follower') return;
  await manager.startEmptyTurn(threadId, {});
}
