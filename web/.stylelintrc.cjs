module.exports = {
  rules: {
    "color-no-hex": [true, { severity: "warning", message: "Use a color token (var(--…)) instead of a hex literal." }],
    "declaration-property-value-disallowed-list": [
      {
        "font-family": [/^(?!var\(--font-(ui|mono|board)\)$|inherit$).+/],
        font: [/^(?!inherit$|var\(--)(?!.*var\(--font-(ui|mono|board)\)).+/],
        "/^border(-\w+)*-radius$/": [/\d(px|rem|em)\b/],
      },
      { message: "Use var(--font-ui)/var(--font-mono)/var(--font-board) and var(--radius-*) tokens." },
    ],
  },
};
