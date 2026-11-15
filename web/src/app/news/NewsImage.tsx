// A news image as it loads. Its box is there at once, a skeleton's fill breathing in it. The image
// fades in over it once loaded, with a hairline edge so a white image doesn't run into the Light
// page. In the story pane the row's
// thumbnail, already loaded for the list, stands in blurred until the large copy comes.
import {useState} from 'react';

/** Calls `loaded` once the image has its pixels, whether they came now or from the cache. */
const whenLoaded = (loaded: () => void) => (image: HTMLImageElement | null) => {
  if (image?.complete && image.naturalWidth > 0) loaded();
};

export function NewsImage({src, blurred}: {src: string; blurred?: string | null}) {
  const [shown, setShown] = useState(false);
  const show = () => setShown(true);
  return (
    <span className={shown ? 'nw-ph done' : 'nw-ph'}>
      {blurred && <img className="nw-blur" src={blurred} alt="" />}
      <img className={shown ? 'nw-img in' : 'nw-img'} src={src} alt="" ref={whenLoaded(show)} onLoad={show} />
    </span>
  );
}
