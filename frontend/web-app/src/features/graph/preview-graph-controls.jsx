import React from 'react';
import { Minus, Pause, Play, Plus, Shrink, SkipBack, SkipForward } from 'lucide-react';
import { ActionButton } from '../../components/primary-button';
import { RangeInput } from '../../components/ui/input';
import { Box, Text } from '../../components/layout-primitives';

export function GraphIconButton({ label, icon: Icon, alternateIcon: AlternateIcon, grouped = false, ...props }) {
  return <ActionButton className="icon-button preview-graph-icon-button" surface={grouped ? 'ghost' : 'floating'}
    shape="circle" data-drawer-button={AlternateIcon ? '' : undefined}
    aria-label={label} title={label} {...props}>
    <Icon className={AlternateIcon ? 'icon idle-icon' : 'icon'} aria-hidden="true" />
    {AlternateIcon && <AlternateIcon className="icon alternate-icon" aria-hidden="true" />}
  </ActionButton>;
}

export function GraphZoomControls({ zoom, onZoom, onFit }) {
  return <Box className="glass floating-glass preview-graph-control-group" role="group" aria-label="그래프 배율">
    <GraphIconButton grouped label="그래프 축소" icon={Minus} onClick={() => onZoom(1 / 1.45)} />
    <Text as="output" aria-label="그래프 확대 비율">{zoom}%</Text>
    <GraphIconButton grouped label="그래프 확대" icon={Plus} onClick={() => onZoom(1.45)} />
    <GraphIconButton grouped label="그래프 화면에 맞추기" icon={Shrink} onClick={onFit} />
  </Box>;
}

export function GraphPlayback({ records, cursor, playing, onPlay, onSeek }) {
  const first = records[0];
  const last = records.at(-1);
  const current = records[cursor - 1];
  return <Box className="glass floating-glass preview-graph-playback" role="group" aria-label="거래 재생">
    <Box className="preview-graph-playback-buttons">
      <GraphIconButton grouped label="이전 거래" icon={SkipBack} disabled={!cursor} onClick={() => onSeek(cursor - 1)} />
      <GraphIconButton grouped label={playing ? '거래 재생 일시 정지' : '거래 재생'} icon={playing ? Pause : Play} onClick={onPlay} />
      <GraphIconButton grouped label="다음 거래" icon={SkipForward} disabled={cursor === records.length} onClick={() => onSeek(cursor + 1)} />
    </Box>
    <Text as="span" aria-hidden="true">{first?.timestamp.slice(5)}</Text>
    <RangeInput aria-label="거래 재생 위치"
      aria-valuetext={current ? `${cursor} / ${records.length}건 · ${current.timestamp} KST` : `0 / ${records.length}건`}
      min={0} max={records.length} value={cursor} onChange={event => onSeek(Number(event.target.value))} />
    {first?.timestamp !== last?.timestamp && <Text as="span" aria-hidden="true">{last?.timestamp.slice(5)}</Text>}
    <Text as="span">{cursor} / {records.length}건</Text>
  </Box>;
}
