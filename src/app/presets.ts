export interface Preset { id: string; label: string; city: string; neighbourhood: string; lens: { label: string; anchors: string[] }; room: string[]; features: string[] }
export const PRESETS: Preset[] = [
  { id: 'east-nashville-design', label: 'East Nashville design', city: 'Nashville', neighbourhood: 'East Nashville', lens: { label: 'Design forward', anchors: ['Herman Miller', 'Kinfolk', 'Khruangbin'] }, room: ['IKEA', 'West Elm'], features: ['natural light', 'front porch'] },
  { id: 'nashville-classic', label: 'Nashville classic', city: 'Nashville', neighbourhood: '', lens: { label: 'Classic comfort', anchors: ['Pottery Barn', 'Martha Stewart Living', 'Norah Jones'] }, room: ['Pottery Barn', 'CB2'], features: ['fireplace', 'hardwood floors'] },
  { id: 'hyde-park-design', label: 'Hyde Park design', city: 'Chicago', neighbourhood: 'Hyde Park', lens: { label: 'Design forward', anchors: ['Herman Miller', 'Kinfolk', 'Khruangbin'] }, room: ['West Elm', 'IKEA'], features: ['reading nook', 'big windows'] },
  { id: 'wicker-park-classic', label: 'Wicker Park classic', city: 'Chicago', neighbourhood: 'Wicker Park', lens: { label: 'Classic comfort', anchors: ['Pottery Barn', 'Martha Stewart Living', 'Norah Jones'] }, room: ['Pottery Barn', 'CB2'], features: ['updated bath', 'high ceilings'] },
  { id: 'toronto-design', label: 'Toronto design', city: 'Toronto', neighbourhood: 'West Queen West', lens: { label: 'Design forward', anchors: ['Herman Miller', 'Kinfolk', 'Khruangbin'] }, room: ['IKEA', 'West Elm'], features: ['open kitchen', 'patio'] },
  { id: 'nashville-design', label: 'Nashville design', city: 'Nashville', neighbourhood: '', lens: { label: 'Design forward', anchors: ['Herman Miller', 'Kinfolk', 'Khruangbin'] }, room: ['CB2', 'West Elm'], features: ['garden', 'home office'] },
]
export function preset(id: string | undefined): Preset | undefined { return PRESETS.find((item) => item.id === id) }
