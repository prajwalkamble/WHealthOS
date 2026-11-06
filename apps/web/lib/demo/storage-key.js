// Where demo mode keeps a guest's own rows.
//
// Its own module, and not a constant inside store.js, for one reason: store.js
// pulls in the sample dataset and the whole dashboard computation, so any
// surface that merely wants to ask "is there a demo session in this browser?"
// would have carried about 12 kB of demo data to ask it. The pricing page does
// exactly that, to decide which buttons to show.
//
// store.js re-exports this, so there is still one name for it and existing
// imports are unaffected.
export const DEMO_STORAGE_KEY = "whealth-demo-transactions";
