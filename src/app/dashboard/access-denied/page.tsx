export default function AccessDenied() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Access restricted</h1>
      <p className="text-gray-600 max-w-sm">
        This tool is limited to the team. If you think this is a mistake, ask whoever manages the
        scheduler to add your email to the allowlist.
      </p>
      <a href="/" className="text-blue-600 underline">
        Back to sign in
      </a>
    </main>
  );
}
