# Deepen admissions and WhatsApp modules

Status: accepted

UniOs has grown several shallow modules where callers directly update lead stages, assemble application state from many tables, or send WhatsApp messages while remembering related logging and state side effects. We will deepen these areas by using named Lead transition commands instead of generic stage setters, a server-backed Application dossier instead of frontend assembly, and Conversation actions that own provider send, message log, outbound context, conversation state, and automation event effects. The Admissions list read module should come after Lead transition and Application dossier so it consumes stable domain facts, while Conversation actions can proceed in parallel and call Lead transition commands whenever they change admission state.
