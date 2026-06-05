// Bootstrap: try to load the user's startup script.
// A missing startup is silently ignored; real errors are re-thrown.
try {
    require("/startup");
} catch (e: unknown) {
    const msg: string = (e as any)?.message ?? String(e);
    if (!msg.startsWith("MODULE_NOT_FOUND")) throw e;
}
