export default function SocialRecoveryUnavailable({ title }: { title: string }) {
  return (
    <section className="w-full max-w-xl mx-auto p-6 bg-white rounded-2xl shadow-xl border border-gray-100">
      <h2 className="text-xl font-bold text-gray-900 mb-3">{title}</h2>
      <p role="status" className="text-sm text-gray-700">
        Social recovery is currently unavailable. You can keep using your existing identity.
      </p>
      <p className="text-sm text-gray-500 mt-3">
        Keep any saved recovery shards secure; they cannot be used here yet.
      </p>
    </section>
  );
}
