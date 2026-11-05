// The shared beginner exercise library used by My plan (HCI proof of concept, requirement F4).
// Each exercise has the muscles it trains (used by the rest-day rules), what equipment it needs,
// how hard it is to learn (1 easiest), plain-language steps, and a demo video link.
// video: a YouTube link (watch, youtu.be or shorts). null = still to be found; the app then shows
// the steps with "Video coming soon". tests/plan.test.ts reports which ones are missing.

export type Muscle =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "core"
  | "cardio";

// What the person has: a gym includes dumbbells, and dumbbells include bodyweight.
export type Equipment = "bodyweight" | "dumbbells" | "gym";

// The movement an exercise fills in a workout; a plan asks for slots, the library fills them.
export type Pattern =
  | "squat"
  | "hinge"
  | "single_leg"
  | "leg_curl"
  | "calves"
  | "h_push"
  | "v_push"
  | "h_pull"
  | "v_pull"
  | "biceps"
  | "triceps"
  | "core"
  | "walk";

export type LibraryExercise = {
  id: string;
  name: string;
  pattern: Pattern;
  muscles: Muscle[];
  needs: Equipment;
  difficulty: 1 | 2 | 3;
  // Logged as reps, or as a hold in seconds (planks).
  hold?: boolean;
  // How the exercise is saved when the workout is started in the logger.
  equipmentType: "free_weight" | "cable" | "pin_machine" | "plate_machine" | "bodyweight" | "other";
  steps: string[];
  video: string | null;
};

export const LIBRARY: LibraryExercise[] = [
  // Legs: squat pattern
  {
    id: "bodyweight-squat",
    name: "Bodyweight Squat",
    pattern: "squat",
    muscles: ["quads", "glutes"],
    needs: "bodyweight",
    difficulty: 1,
    equipmentType: "bodyweight",
    steps: [
      "Stand with feet about shoulder-width apart, toes turned out slightly.",
      "Sit your hips back and down as if into a chair, keeping your chest up.",
      "Go as low as is comfortable with your heels on the floor, then stand back up.",
    ],
    video: null,
  },
  {
    id: "goblet-squat",
    name: "Goblet Squat",
    pattern: "squat",
    muscles: ["quads", "glutes"],
    needs: "dumbbells",
    difficulty: 1,
    equipmentType: "free_weight",
    steps: [
      "Hold one dumbbell upright against your chest with both hands.",
      "Squat down between your knees, keeping your elbows inside your knees and chest tall.",
      "Push through your whole foot to stand back up.",
    ],
    video: null,
  },
  {
    id: "leg-press",
    name: "Leg Press",
    pattern: "squat",
    muscles: ["quads", "glutes"],
    needs: "gym",
    difficulty: 1,
    equipmentType: "plate_machine",
    steps: [
      "Sit with your back flat on the pad and feet shoulder-width on the platform.",
      "Release the safety handles and lower the platform until your knees are bent about 90 degrees.",
      "Press back up without locking your knees, then put the safeties back when you finish.",
    ],
    video: null,
  },
  {
    id: "barbell-back-squat",
    name: "Barbell Back Squat",
    pattern: "squat",
    muscles: ["quads", "glutes"],
    needs: "gym",
    difficulty: 3,
    equipmentType: "free_weight",
    steps: [
      "Set the bar in a rack at chest height and the safety bars just below your lowest squat.",
      "Rest the bar on your upper back, step back, and stand with feet shoulder-width.",
      "Brace your stomach, squat down until your thighs are about level with the floor, and stand up.",
    ],
    video: null,
  },
  // Legs: hinge pattern
  {
    id: "glute-bridge",
    name: "Glute Bridge",
    pattern: "hinge",
    muscles: ["glutes", "hamstrings"],
    needs: "bodyweight",
    difficulty: 1,
    equipmentType: "bodyweight",
    steps: [
      "Lie on your back with knees bent and feet flat, close to your hips.",
      "Squeeze your glutes and lift your hips until your body is straight from knees to shoulders.",
      "Pause for a second at the top, then lower slowly.",
    ],
    video: null,
  },
  {
    id: "dumbbell-romanian-deadlift",
    name: "Dumbbell Romanian Deadlift",
    pattern: "hinge",
    muscles: ["hamstrings", "glutes"],
    needs: "dumbbells",
    difficulty: 2,
    equipmentType: "free_weight",
    steps: [
      "Stand holding a dumbbell in each hand in front of your thighs, knees slightly bent.",
      "Push your hips back and slide the weights down your legs, keeping your back flat.",
      "Stop when you feel a stretch in the back of your legs, then drive your hips forward to stand.",
    ],
    video: null,
  },
  {
    id: "hip-thrust-machine",
    name: "Hip Thrust",
    pattern: "hinge",
    muscles: ["glutes", "hamstrings"],
    needs: "gym",
    difficulty: 2,
    equipmentType: "plate_machine",
    steps: [
      "Sit on the floor with your upper back against a bench and a padded bar across your hips.",
      "Plant your feet flat and push through your heels to lift your hips level with your shoulders.",
      "Squeeze your glutes at the top and lower with control.",
    ],
    video: null,
  },
  {
    id: "barbell-romanian-deadlift",
    name: "Barbell Romanian Deadlift",
    pattern: "hinge",
    muscles: ["hamstrings", "glutes"],
    needs: "gym",
    difficulty: 3,
    equipmentType: "free_weight",
    steps: [
      "Hold a barbell at hip height with hands just outside your legs.",
      "With knees slightly bent, push your hips back and lower the bar along your legs with a flat back.",
      "Stop below the knees or when your back starts to round, then stand tall.",
    ],
    video: null,
  },
  // Legs: one leg at a time
  {
    id: "reverse-lunge",
    name: "Reverse Lunge",
    pattern: "single_leg",
    muscles: ["quads", "glutes"],
    needs: "bodyweight",
    difficulty: 1,
    equipmentType: "bodyweight",
    steps: [
      "Stand tall, then take a big step back with one foot.",
      "Lower until both knees are bent about 90 degrees, back knee just above the floor.",
      "Push through the front foot to return, then switch legs.",
    ],
    video: null,
  },
  {
    id: "dumbbell-step-up",
    name: "Dumbbell Step-up",
    pattern: "single_leg",
    muscles: ["quads", "glutes"],
    needs: "dumbbells",
    difficulty: 1,
    equipmentType: "free_weight",
    steps: [
      "Hold a dumbbell in each hand and face a sturdy box or bench about knee height.",
      "Put one whole foot on the box and push through it to stand up on top.",
      "Step back down with control and repeat, then switch legs.",
    ],
    video: null,
  },
  {
    id: "bulgarian-split-squat",
    name: "Bulgarian Split Squat",
    pattern: "single_leg",
    muscles: ["quads", "glutes"],
    needs: "dumbbells",
    difficulty: 2,
    equipmentType: "free_weight",
    steps: [
      "Stand a stride in front of a bench and rest the top of your back foot on it.",
      "Lower straight down until your front thigh is about level with the floor.",
      "Push through the front foot to stand, finish the reps, then switch legs.",
    ],
    video: null,
  },
  // Legs: hamstring curl and calves
  {
    id: "lying-leg-curl",
    name: "Lying Leg Curl",
    pattern: "leg_curl",
    muscles: ["hamstrings"],
    needs: "gym",
    difficulty: 1,
    equipmentType: "pin_machine",
    steps: [
      "Lie face down on the machine with the pad just above your heels.",
      "Curl your heels toward your glutes without lifting your hips.",
      "Lower slowly until your legs are almost straight.",
    ],
    video: null,
  },
  {
    id: "standing-calf-raise",
    name: "Standing Calf Raise",
    pattern: "calves",
    muscles: ["calves"],
    needs: "bodyweight",
    difficulty: 1,
    equipmentType: "bodyweight",
    steps: [
      "Stand with the balls of your feet on a step, holding something for balance.",
      "Rise up onto your toes as high as you can.",
      "Lower your heels slowly below the step for a stretch, then repeat.",
    ],
    video: null,
  },
  // Chest: horizontal push
  {
    id: "incline-push-up",
    name: "Incline Push-up",
    pattern: "h_push",
    muscles: ["chest", "triceps"],
    needs: "bodyweight",
    difficulty: 1,
    equipmentType: "bodyweight",
    steps: [
      "Put your hands on a bench, counter or wall, a little wider than your shoulders.",
      "Keep your body in a straight line and lower your chest toward your hands.",
      "Push back up. The higher your hands, the easier it is.",
    ],
    video: null,
  },
  {
    id: "push-up",
    name: "Push-up",
    pattern: "h_push",
    muscles: ["chest", "triceps"],
    needs: "bodyweight",
    difficulty: 2,
    equipmentType: "bodyweight",
    steps: [
      "Start in a high plank with hands a little wider than your shoulders.",
      "Lower your chest to just above the floor, elbows angled back, body straight.",
      "Push the floor away to come back up. Drop to your knees if you need to.",
    ],
    video: null,
  },
  {
    id: "dumbbell-floor-press",
    name: "Dumbbell Floor Press",
    pattern: "h_push",
    muscles: ["chest", "triceps"],
    needs: "dumbbells",
    difficulty: 1,
    equipmentType: "free_weight",
    steps: [
      "Lie on your back with knees bent and a dumbbell in each hand, upper arms on the floor.",
      "Press the dumbbells up over your chest until your arms are straight.",
      "Lower until your elbows touch the floor, then press again.",
    ],
    video: null,
  },
  {
    id: "machine-chest-press",
    name: "Machine Chest Press",
    pattern: "h_push",
    muscles: ["chest", "triceps"],
    needs: "gym",
    difficulty: 1,
    equipmentType: "pin_machine",
    steps: [
      "Adjust the seat so the handles line up with the middle of your chest.",
      "Press the handles forward until your arms are straight but not locked.",
      "Let them come back slowly until you feel a stretch in your chest.",
    ],
    video: null,
  },
  {
    id: "dumbbell-bench-press",
    name: "Dumbbell Bench Press",
    pattern: "h_push",
    muscles: ["chest", "triceps"],
    needs: "gym",
    difficulty: 2,
    equipmentType: "free_weight",
    steps: [
      "Lie on a flat bench with a dumbbell in each hand at chest level.",
      "Press the dumbbells up until your arms are straight over your chest.",
      "Lower them slowly to the sides of your chest and press again.",
    ],
    video: null,
  },
  {
    id: "barbell-bench-press",
    name: "Barbell Bench Press",
    pattern: "h_push",
    muscles: ["chest", "triceps"],
    needs: "gym",
    difficulty: 3,
    equipmentType: "free_weight",
    steps: [
      "Lie on the bench with eyes under the bar and feet flat. Use the safety arms or a spotter.",
      "Grip a little wider than shoulders, unrack, and lower the bar to your lower chest.",
      "Press it back up over your shoulders.",
    ],
    video: null,
  },
  // Shoulders: vertical push
  {
    id: "dumbbell-shoulder-press",
    name: "Seated Dumbbell Shoulder Press",
    pattern: "v_push",
    muscles: ["shoulders", "triceps"],
    needs: "dumbbells",
    difficulty: 1,
    equipmentType: "free_weight",
    steps: [
      "Sit tall holding a dumbbell in each hand at shoulder height, palms forward.",
      "Press the weights overhead until your arms are straight.",
      "Lower them back to your shoulders with control.",
    ],
    video: null,
  },
  {
    id: "pike-push-up",
    name: "Pike Push-up",
    pattern: "v_push",
    muscles: ["shoulders", "triceps"],
    needs: "bodyweight",
    difficulty: 2,
    equipmentType: "bodyweight",
    steps: [
      "Start in a push-up position, then walk your feet in so your hips point up like an upside-down V.",
      "Bend your elbows to lower the top of your head toward the floor between your hands.",
      "Push back up to the V.",
    ],
    video: null,
  },
  {
    id: "machine-shoulder-press",
    name: "Machine Shoulder Press",
    pattern: "v_push",
    muscles: ["shoulders", "triceps"],
    needs: "gym",
    difficulty: 1,
    equipmentType: "pin_machine",
    steps: [
      "Set the seat so the handles start at about shoulder height.",
      "Press the handles overhead until your arms are almost straight.",
      "Lower slowly back to the start.",
    ],
    video: null,
  },
  // Back: horizontal pull
  {
    id: "superman",
    name: "Superman",
    pattern: "h_pull",
    muscles: ["back"],
    needs: "bodyweight",
    difficulty: 1,
    equipmentType: "bodyweight",
    steps: [
      "Lie face down with arms stretched out in front of you.",
      "Lift your arms, chest and legs a few inches off the floor and squeeze your back.",
      "Hold for two seconds, then lower.",
    ],
    video: null,
  },
  {
    id: "one-arm-dumbbell-row",
    name: "One-arm Dumbbell Row",
    pattern: "h_pull",
    muscles: ["back", "biceps"],
    needs: "dumbbells",
    difficulty: 1,
    equipmentType: "free_weight",
    steps: [
      "Put one hand and knee on a bench (or one hand on a chair) with your back flat.",
      "Hold a dumbbell in the other hand and pull it up to your hip, elbow close to your side.",
      "Lower it until your arm is straight. Finish the reps, then switch sides.",
    ],
    video: null,
  },
  {
    id: "seated-cable-row",
    name: "Seated Cable Row",
    pattern: "h_pull",
    muscles: ["back", "biceps"],
    needs: "gym",
    difficulty: 1,
    equipmentType: "cable",
    steps: [
      "Sit with feet on the platform and knees slightly bent, holding the handle with straight arms.",
      "Sit tall and pull the handle to your stomach, squeezing your shoulder blades together.",
      "Let your arms straighten slowly without rounding your back.",
    ],
    video: null,
  },
  {
    id: "doorframe-row",
    name: "Doorframe Row",
    pattern: "h_pull",
    muscles: ["back", "biceps"],
    needs: "bodyweight",
    difficulty: 1,
    equipmentType: "bodyweight",
    steps: [
      "Stand in a sturdy doorway and grip both sides of the frame at chest height, feet close to the door.",
      "Lean back with straight arms and a straight body.",
      "Pull your chest toward the frame by squeezing your shoulder blades, then lower back slowly.",
    ],
    video: null,
  },
  // Back: vertical pull
  {
    id: "reverse-snow-angel",
    name: "Reverse Snow Angel",
    pattern: "v_pull",
    muscles: ["back"],
    needs: "bodyweight",
    difficulty: 1,
    equipmentType: "bodyweight",
    steps: [
      "Lie face down with arms by your sides, palms down, and lift your hands and chest slightly.",
      "Sweep your arms out and around in an arc until your hands meet overhead.",
      "Sweep them back to your sides, keeping them off the floor the whole time.",
    ],
    video: null,
  },
  {
    id: "prone-y-raise",
    name: "Prone Y Raise",
    pattern: "v_pull",
    muscles: ["back"],
    needs: "bodyweight",
    difficulty: 1,
    equipmentType: "bodyweight",
    steps: [
      "Lie face down with your arms overhead in a Y shape, thumbs pointing up.",
      "Lift your arms off the floor by squeezing your upper back, keeping your neck relaxed.",
      "Hold for a second at the top, then lower.",
    ],
    video: null,
  },
  {
    id: "lat-pulldown",
    name: "Lat Pulldown",
    pattern: "v_pull",
    muscles: ["back", "biceps"],
    needs: "gym",
    difficulty: 1,
    equipmentType: "cable",
    steps: [
      "Sit with your thighs under the pad and grip the bar a little wider than your shoulders.",
      "Lean back slightly and pull the bar to your upper chest, elbows down and back.",
      "Let the bar rise slowly until your arms are straight.",
    ],
    video: null,
  },
  {
    id: "assisted-pull-up",
    name: "Assisted Pull-up",
    pattern: "v_pull",
    muscles: ["back", "biceps"],
    needs: "gym",
    difficulty: 2,
    equipmentType: "pin_machine",
    steps: [
      "Kneel or stand on the assist pad and grip the handles overhead. More weight means more help.",
      "Pull yourself up until your chin is over the handles.",
      "Lower slowly until your arms are straight.",
    ],
    video: null,
  },
  // Arms
  {
    id: "dumbbell-curl",
    name: "Dumbbell Curl",
    pattern: "biceps",
    muscles: ["biceps"],
    needs: "dumbbells",
    difficulty: 1,
    equipmentType: "free_weight",
    steps: [
      "Stand holding a dumbbell in each hand, palms facing forward.",
      "Curl the weights up toward your shoulders, keeping your elbows by your sides.",
      "Lower them slowly all the way down.",
    ],
    video: null,
  },
  {
    id: "hammer-curl",
    name: "Hammer Curl",
    pattern: "biceps",
    muscles: ["biceps"],
    needs: "dumbbells",
    difficulty: 1,
    equipmentType: "free_weight",
    steps: [
      "Hold a dumbbell in each hand with palms facing each other.",
      "Curl the weights up, keeping your palms facing in and elbows still.",
      "Lower slowly.",
    ],
    video: null,
  },
  {
    id: "bench-dip",
    name: "Bench Dip",
    pattern: "triceps",
    muscles: ["triceps"],
    needs: "bodyweight",
    difficulty: 2,
    equipmentType: "bodyweight",
    steps: [
      "Sit on the edge of a sturdy chair or bench, hands next to your hips, and slide off the edge.",
      "Bend your elbows straight back to lower your hips a few inches.",
      "Press back up. Bend your knees more to make it easier.",
    ],
    video: null,
  },
  {
    id: "overhead-dumbbell-extension",
    name: "Overhead Dumbbell Triceps Extension",
    pattern: "triceps",
    muscles: ["triceps"],
    needs: "dumbbells",
    difficulty: 1,
    equipmentType: "free_weight",
    steps: [
      "Hold one dumbbell overhead with both hands.",
      "Bend your elbows to lower it behind your head, keeping elbows pointing up.",
      "Straighten your arms to lift it back up.",
    ],
    video: null,
  },
  {
    id: "cable-triceps-pushdown",
    name: "Cable Triceps Pushdown",
    pattern: "triceps",
    muscles: ["triceps"],
    needs: "gym",
    difficulty: 1,
    equipmentType: "cable",
    steps: [
      "Face a high cable with a rope or bar, elbows tucked at your sides.",
      "Push the handle down until your arms are straight.",
      "Let it come back up to about chest height without moving your elbows.",
    ],
    video: null,
  },
  // Core
  {
    id: "dead-bug",
    name: "Dead Bug",
    pattern: "core",
    muscles: ["core"],
    needs: "bodyweight",
    difficulty: 1,
    equipmentType: "bodyweight",
    steps: [
      "Lie on your back with arms pointing up and knees bent over your hips.",
      "Press your lower back into the floor, then slowly reach one arm back and the opposite leg out.",
      "Return and switch sides. Keep your lower back on the floor the whole time.",
    ],
    video: null,
  },
  {
    id: "plank",
    name: "Plank",
    pattern: "core",
    muscles: ["core"],
    needs: "bodyweight",
    difficulty: 1,
    hold: true,
    equipmentType: "bodyweight",
    steps: [
      "Rest on your forearms and toes with elbows under your shoulders.",
      "Keep a straight line from head to heels; squeeze your stomach and glutes.",
      "Hold without letting your hips sag. Drop to your knees to make it easier.",
    ],
    video: null,
  },
  {
    id: "bird-dog",
    name: "Bird Dog",
    pattern: "core",
    muscles: ["core"],
    needs: "bodyweight",
    difficulty: 1,
    equipmentType: "bodyweight",
    steps: [
      "Start on hands and knees with a flat back.",
      "Reach one arm forward and the opposite leg back until both are straight.",
      "Hold for a second, return, and switch sides.",
    ],
    video: null,
  },
  {
    id: "side-plank",
    name: "Side Plank",
    pattern: "core",
    muscles: ["core"],
    needs: "bodyweight",
    difficulty: 2,
    hold: true,
    equipmentType: "bodyweight",
    steps: [
      "Lie on your side and prop yourself up on one forearm, elbow under your shoulder.",
      "Lift your hips so your body is straight from head to feet.",
      "Hold, then switch sides. Bend your knees to make it easier.",
    ],
    video: null,
  },
  // Optional easy day
  {
    id: "brisk-walk",
    name: "Brisk Walk",
    pattern: "walk",
    muscles: ["cardio"],
    needs: "bodyweight",
    difficulty: 1,
    equipmentType: "other",
    steps: [
      "Walk at a pace where you can talk but not sing, for 20 to 30 minutes.",
      "Keep it easy: this day helps you recover and builds the habit.",
    ],
    video: null,
  },
];

export const LIBRARY_BY_ID: Record<string, LibraryExercise> = Object.fromEntries(LIBRARY.map((e) => [e.id, e]));

// Turns a YouTube watch, youtu.be or shorts link into a privacy-friendly embed URL, or null.
export function embedUrl(video: string | null): string | null {
  if (!video) return null;
  const m = video.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}
