// FPS UI Pack assets, imported through Vite so the URLs are hashed and resolve
// correctly under the GitHub Pages subpath. Exposed as CSS custom properties.
import playBtn from './PlayBtn.png'
import playBtnPressed from './PlayBtnPressed.png'
import btn from './Btn.png'
import btnPressed from './BtnPressed.png'
import selectedTab from './SelectedTab.png'
import unselectedTab from './UnselectedTab.png'
import coin from './CoinIcon.png'
import addFriend from './AddFriendIcon.png'
import bell from './BellIcon.png'
import online from './OnlineIcon.png'
import largeFrame from './LargeFrame.png'
import frameBlue from './FrameBlue.png'
import darkBg from './DarkBGContainer.png'
import levelBar from './LevelBar.png'
import levelBarBg from './LevelBarContainer.png'
import background from './Background.jpg'
import neonFrame from './neon-frame.png'

const vars = {
  '--ui-play': `url(${playBtn})`,
  '--ui-play-pressed': `url(${playBtnPressed})`,
  '--ui-btn': `url(${btn})`,
  '--ui-btn-pressed': `url(${btnPressed})`,
  '--ui-tab': `url(${unselectedTab})`,
  '--ui-tab-active': `url(${selectedTab})`,
  '--ui-coin': `url(${coin})`,
  '--ui-addfriend': `url(${addFriend})`,
  '--ui-bell': `url(${bell})`,
  '--ui-online': `url(${online})`,
  '--ui-frame': `url(${largeFrame})`,
  '--ui-frame-blue': `url(${frameBlue})`,
  '--ui-darkbg': `url(${darkBg})`,
  '--ui-levelbar': `url(${levelBar})`,
  '--ui-levelbar-bg': `url(${levelBarBg})`,
  '--ui-bg': `url(${background})`,
  '--ui-neon': `url(${neonFrame})`,
}
const root = document.documentElement
for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
document.documentElement.classList.add('ui-pack')
