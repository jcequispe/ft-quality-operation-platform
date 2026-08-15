import gasPlugin from "@gas-plugin/unplugin/bun";

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  plugins: [
    gasPlugin({
    include: ["src/**/*.html", "src/**/*.css"],
    globals: ["doGet","doPost"],
    autoGlobals: true,
    }),
  ],
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}
