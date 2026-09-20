type FollowManager = {
  getHostId(): string;
  getStreamRole(id: string): {role: string} | null;
  addStreamRoleStateCallback(callback: (id: string) => void): () => void;
  streamState: {setConversationFollowing(id: string, following: boolean): void};
  ipcBridge: {
    findThreadOwner(params: {hostId: string; conversationId: string}): Promise<string | null>;
    threadStreamFollowingChanged(params: {hostId: string; conversationId: string; following: boolean; targetClientIds: string[]}): Promise<void>;
  };
  logger: {warning(message: string, fields: unknown): void};
};

// Request the real owner's normal snapshot. Only receipt of that snapshot may
// establish a follower role; discovery alone is not sufficient.
export async function followExistingOwner(manager: FollowManager, id: string, current: () => boolean, timeoutMs=15000) {
  if(manager.getHostId()!=='local' || manager.getStreamRole(id)!=null || !current())return;
  let remove=()=>{},timer:ReturnType<typeof setTimeout>|undefined,requested=false;
  const deadline=new Promise<void>(resolve=>{timer=setTimeout(resolve,timeoutMs)});
  try {
    let owner: string | null;
    try {owner=await Promise.race([manager.ipcBridge.findThreadOwner({hostId:'local',conversationId:id}),deadline.then(()=>null)]);}
    catch {return;} // The subsequent engine resume still enforces its writer lock.
    if(!owner || !current() || manager.getStreamRole(id)!=null)return;
    let finish=()=>{};
    const ready=new Promise<void>(resolve=>{
      finish=resolve;
      remove=manager.addStreamRoleStateCallback(thread=>{
        if(thread===id && manager.getStreamRole(id)?.role==='follower')resolve();
      });
    });
    requested=true;
    manager.streamState.setConversationFollowing(id,true);
    const notified=manager.ipcBridge.threadStreamFollowingChanged({hostId:'local',conversationId:id,following:true,targetClientIds:[owner]});
    if(manager.getStreamRole(id)?.role==='follower')finish();
    // Receipt of the snapshot is authoritative. An IPC acknowledgement may be
    // lost independently; neither it nor owner discovery can outlive the deadline.
    await Promise.race([ready,deadline,notified.then(()=>ready)]);
    if(current() && manager.getStreamRole(id)?.role!=='follower')throw Error('The task owner on the remote computer was found, but its state has not arrived. Try opening the task again.');
  } finally {
    remove();if(timer)clearTimeout(timer);
    if(requested && manager.getStreamRole(id)==null)manager.streamState.setConversationFollowing(id,false);
  }
}
