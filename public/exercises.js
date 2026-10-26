// Starter set, interleaved so consecutive slots work different areas.
// `timer` is optional: { work, rest, rounds } in seconds.
export const DEFAULT_EXERCISES = [
  { id: "squat", name: "Bodyweight squats", category: "legs", detail: "3 × 15", cue: "Sit back, chest up, knees track over toes." },
  { id: "doorway-chest", name: "Doorway chest stretch", category: "stretch", detail: "2 × 30s", cue: "Forearms on the frame, step through gently.", timer: { work: 30, rest: 10, rounds: 2 } },
  { id: "pushup", name: "Push-ups", category: "push", detail: "3 × 10", cue: "Body in one straight line. Knees down is fine." },
  { id: "hip-flexor", name: "Hip flexor stretch", category: "stretch", detail: "45s each side", cue: "Half-kneel, squeeze the back glute, shift forward.", timer: { work: 45, rest: 5, rounds: 2 } },
  { id: "plank", name: "Plank", category: "core", detail: "3 × 40s", cue: "Elbows under shoulders, ribs down, breathe.", timer: { work: 40, rest: 20, rounds: 3 } },
  { id: "reverse-lunge", name: "Reverse lunges", category: "legs", detail: "3 × 10 each leg", cue: "Step back, drop the back knee, push through the front heel." },
  { id: "cat-cow", name: "Cat–cow", category: "stretch", detail: "10 slow reps", cue: "Move with the breath, one vertebra at a time." },
  { id: "desk-pushup", name: "Incline push-ups (desk)", category: "push", detail: "3 × 12", cue: "Hands on a sturdy desk edge, chest to the edge." },
  { id: "glute-bridge", name: "Glute bridges", category: "legs", detail: "3 × 15", cue: "Drive through the heels, squeeze at the top for 1s." },
  { id: "hamstring", name: "Standing hamstring stretch", category: "stretch", detail: "45s each side", cue: "Heel on a low step, hinge at the hips, long spine.", timer: { work: 45, rest: 5, rounds: 2 } },
  { id: "dead-bug", name: "Dead bug", category: "core", detail: "3 × 10 each side", cue: "Low back stays glued to the floor." },
  { id: "wall-sit", name: "Wall sit", category: "legs", detail: "3 × 40s", cue: "Thighs parallel, back flat on the wall.", timer: { work: 40, rest: 20, rounds: 3 } },
  { id: "open-book", name: "Open book rotations", category: "stretch", detail: "8 each side", cue: "Lie on your side, knees stacked, open the top arm." },
  { id: "chair-dip", name: "Chair dips", category: "push", detail: "3 × 10", cue: "Use a chair that won't roll. Elbows point back." },
  { id: "calf-raise", name: "Calf raises", category: "legs", detail: "3 × 20", cue: "Slow up, slower down. Hold a wall for balance." },
  { id: "neck-shoulders", name: "Neck & shoulder release", category: "stretch", detail: "60s", cue: "Shoulder rolls, then ear to shoulder each side.", timer: { work: 60, rest: 0, rounds: 1 } },
];
