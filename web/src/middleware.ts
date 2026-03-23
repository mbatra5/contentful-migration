import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const user = process.env.AUTH_USER;
  const pass = process.env.AUTH_PASS;

  if (!user || !pass) return NextResponse.next();

  const auth = req.headers.get('authorization');
  if (auth) {
    const [, encoded] = auth.split(' ');
    try {
      const decoded = atob(encoded);
      const [u, p] = decoded.split(':');
      if (u === user && p === pass) return NextResponse.next();
    } catch { /* invalid base64 */ }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Contentful Migrator"' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
