This app works in concert with the router app at `../fly-router`

the job of this app is to:

1. receive a change notification containing the computer id whenever the
   computer's on disk info has changed, which will cause this app to:
   - read the filesystem path `computers/<computer-id>/exec/*` and see if any
     have a software state that requires changes to hardware
   - reconcile the hardware state with the software state, and update any
     instances with the changed hardware state

2. manage faults in the hardware to keep the system up

3. receive requests that were meant for a specific machine but failed to replay,
   then replay those back to the place the replay last came from

## The reconciliation process

This process needs to ensure that the on disk state of the computers exec folder
matches the fly.io machines. If a file exists and it is in hardware state
'queued' then that means we have to go and make it be a real machine. We move
the state to 'starting' and proceed to create or commandeer a waiting machine.
Once it has started we move the state to running.

There is no 'stopped' state, since once the machine is stopped, the json file is
deleted

## Notes

the name of the instance file on disk is equal to the agent id in the agents/
folder.
