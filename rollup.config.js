import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default [
	// ESM 构建
	{
		input: "src/index.js",
		output: {
			file: "dist/index.mjs",
			format: "esm",
			exports: "named",
		},
		plugins: [resolve(), commonjs()],
		external: ["axios", "dayjs"],
	},
	// CommonJS 构建
	{
		input: "src/index.js",
		output: {
			file: "dist/index.cjs",
			format: "cjs",
			exports: "named",
		},
		plugins: [resolve(), commonjs()],
		external: ["axios", "dayjs"],
	},
];
