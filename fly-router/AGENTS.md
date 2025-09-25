the router is here to:

1. receive requests on the base domain, eg: `https://agentic.dreamcatcher.land`
   - this request needs to loop out to clerk if the browser is not authed
   - based on the clerk id, create the actor computer if it does not exist
   - redirect the browser to the url for the actor computer
2. receive request of the form `<actor-computer>.<base-domain>` eg:
   `https://computer-1.agentic.dreamcatcher.land`
   - 404 if the computer does not exist
   - find the landing agent by reading the computer config
   - if required, create a new landing agent to serve this request
   - redirect the browser to the url for the agent
3. receive requests of the form
   `<agent-name>--<actor-computer> eg:`https://agent-1--computer-1.agentic.dreamcatcher.land`
   - 404 if the computer does not exist
   - 404 if the agent does not exist on the computer
   - ping the exec service to ensure the service is awakened
   - read the computer config to see if a machine is currently serving this
     agent
   - if no machine is serving, write a new machine entry pointing to the agent
     folder with the status NEEDED
   - wait until the status is changed to running by the exec service
   - read inside the config what the machine-id that is serving this request is
   - fly replay over to the exec app with a prefer-instance header using the
     machine-id
   - if the default exec agent receives it, it will always replay back to the
     router to try again

## The subdomain naming convention:

- `--` is treated as the separator between agent name and computer name.
- names are of the form `<agent-name>--<actor-computer>.<base-domain>
- the right segment is the computer name
- the left segment is the agent name
