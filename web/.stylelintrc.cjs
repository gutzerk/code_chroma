module.exports = {
  rules: {
    "color-no-hex": [true, { severity: "warning", message: "Use a color token (var(--…)) instead of a hex literal." }],
    "declaration-property-value-disallowed-list": [
      {
        "font-family": [/^(?!var\(--font-(ui|mono)\)$|inherit$).+/],
        font: [/^(?!inherit$|var\(--)(?!.*var\(--font-(ui|mono)\)).+/],
        "/^border(-\w+)*-radius$/": [/\d(px|rem|em)\b/],
      },
      { message: "Use var(--font-ui)/var(--font-mono) and var(--radius-*) tokens." },
    ],
  },
};
