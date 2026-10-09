// A gym. Removed gyms keep archived_at set; they disappear from the dropdown but nothing is deleted.
export type Gym = {
  id: string;
  name: string;
  photo_path?: string | null;
  archived_at?: string | null;
};
