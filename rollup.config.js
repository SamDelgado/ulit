import babel from "rollup-plugin-babel";

export default {
  input: "./src/index.js",
  name: "ulit",
  output: {
    file: "./dist/ulit.js",
    format: "umd"
  },
  sourcemap: true,
  plugins: [
    babel({
      babelrc: false,
      presets: [["env", { modules: false }]],
      plugins: []
    })
  ],
  globals: {},
  external: []
};
