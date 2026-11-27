/** Yellow banner shown on the sample (mock) stack only. */
export function SampleBanner({ mode }: { mode: "mock" | "live" }) {
  if (mode !== "mock") return null;
  return (
    <div className="bg-yellow-400 text-black text-center text-sm font-semibold py-1">
      SAMPLE DATA
    </div>
  );
}
