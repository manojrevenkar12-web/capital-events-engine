/** Motion constants: one orchestrated reveal per page, and responses to what a person does. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const DURATION = { quick: 0.16, base: 0.28, slow: 0.5 } as const;
export const STAGGER = 0.045;

export const reveal = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
};

export const listReveal = {
  hidden: {},
  shown: { transition: { staggerChildren: STAGGER } },
};
