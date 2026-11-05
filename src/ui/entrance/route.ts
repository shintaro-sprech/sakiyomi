// The entrance is at / and the app at /app, so a reload or a bookmark opens the app straight
// away, and the browser's back button returns to the entrance. The Worker serves the page for
// /app as it does for any path that is not a file.
export const APP_PATH = '/app'

export const isAppPath = (pathname: string) => pathname === APP_PATH || pathname.startsWith(`${APP_PATH}/`)
