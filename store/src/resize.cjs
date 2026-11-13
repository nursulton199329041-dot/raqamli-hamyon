// node resize.cjs <in> <out> <size> [opaque]
const Jimp = require(require.resolve('jimp-compact', { paths: [process.cwd()] }));
(async () => {
  const [, , inp, out, size, opaque] = process.argv;
  const img = await Jimp.read(inp);
  img.resize(Number(size), Number(size), Jimp.RESIZE_BICUBIC);
  if (opaque) img.rgba(false);
  await img.writeAsync(out);
})().catch((e) => { console.error(e); process.exit(1); });
