/**
 * Layout for the print route only.
 *
 * The print page used to live inside the `(app)` group, which means it was
 * wrapped in AppLayout: a `h-screen` flex row with the 250px sidebar, the user
 * card and the toast region. Nothing in that shell was hidden from print, in any
 * browser, because there was never a print rule for it.
 *
 * The result was a real document coming out of the printer wrong. A member of
 * the sales team saved it from Safari and the sheet carried the whole
 * navigation - "CoreDesk", "Executive Dashboard", "Leads Database" - with the
 * quotation pushed 66mm to the right and clipped, so "Official Quotation" printed
 * as "ial Quotation" and "Package" as "kage".
 *
 * Moving the route out of the shell is the fix, rather than hiding the shell.
 * Hiding it would mean relying on `print:hidden` landing correctly on every
 * engine, while the shell's `h-screen` and `overflow-hidden` stayed in the print
 * box - and Safari has a long history of disagreeing about both. Not rendering
 * the sidebar is not something Safari can disagree with.
 *
 * Nothing else is lost. The print page already calls `requireUser()`, which
 * redirects an unauthenticated visitor to /login and a pending account to
 * /pending, so auth and the pending gate are unchanged.
 *
 * The URL is unaffected: route groups are not part of the path.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
