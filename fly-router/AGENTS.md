the router is here to:

1. receive requests on the base domain, eg: `https://agentic.dreamcatcher.land`
   - this request needs to loop out to clerk if the browser is not authed
   - based on the clerk id, create the actor computer if it does not exist
   - redirect the browser to the url for the actor computer
2. receive request on the computer domain, which are of the form
   `<actor-computer>.<base-domain>` eg:
   `https://computer-1.agentic.dreamcatcher.land`
   - 404 if the computer does not exist
   - find the landing agent by reading the computer config
   - if required, create a new landing agent to serve this request
   - post to the exec service to notify if that the computer has changed
   - redirect the browser to the url for the agent
3. receive requests on the agent domain, which are of the form
   `<agent-name>--<actor-computer> eg:`https://agent-1--computer-1.agentic.dreamcatcher.land`
   - 404 if the computer does not exist
   - 404 if the agent does not exist on the computer
   - read the computer config to see if a machine is currently serving this
     agent
   - if no machine is serving, write a new instance entry for the agent
   - post to the exec servive to notify it that the computer has changed
   - poll the instance that it created until a change is detected
   - read inside the config what the machine-id which the exec service added
   - fly replay over to the exec app with a specific instance header using the
     machine-id the exec service added

## The subdomain naming convention:

- `--` is treated as the separator between agent name and computer name.
- names are of the form `<agent-name>--<actor-computer>.<base-domain>
- the right segment is the computer name
- the left segment is the agent name

## relationship to the exec app

The exec app which is at ../fly-exec is the cooperating partner of this app
