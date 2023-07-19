export type Rating = 'e' | 'q' | 's';

export interface Post {
  postId:         number;
  parentId?:      number | null;
  md5:            string;
  uploaderId:     number;
  approverId?:    number | null;
  createdAt:      Date;
  updatedAt?:     Date | null;
  rating:         Rating;
  imageWidth:     number;
  imageHeight:    number;
  fileExt:        string;
  fileSize:       number;
  commentCount:   number;
  description:    string;
  duration?:      number | null;
  score:          number;
  upScore:        number;
  downScore:      number;
  favCount:       number;
  isDeleted:      boolean;
  isPending:      boolean;
  isFlagged:      boolean;
  isRatingLocked: boolean;
  isStatusLocked: boolean;
  isNoteLocked:   boolean;
  tags:           string[];
  sources:        string[];
}

export interface PostSelection {
  postId: number,
  rating: Rating
  score: number,
  favCount: number,
  isDownloaded: boolean,
  isSelected: boolean
}
