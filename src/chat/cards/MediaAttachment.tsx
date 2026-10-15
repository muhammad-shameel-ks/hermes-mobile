import { mediaKind, mediaName } from '../media.ts';
import { AudioCard } from './AudioCard.tsx';
import { FileCard } from './FileCard.tsx';
import { MediaImage } from './MediaImage.tsx';
import { VideoCard } from './VideoCard.tsx';

/** a file a reply delivers, as the player or picture its kind calls for; any other file degrades to copy-path */
export function MediaAttachment({ path }: { path: string }) {
  switch (mediaKind(path)) {
    case 'image':
      return <MediaImage src={path} alt={mediaName(path)} />;
    case 'video':
      return <VideoCard path={path} />;
    case 'audio':
      return <AudioCard path={path} />;
    default:
      return <FileCard path={path} />;
  }
}
