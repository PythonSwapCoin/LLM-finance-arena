import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { Agent, Benchmark } from '../types';
import { INITIAL_CASH } from '../constants';

type Participant = Agent | Benchmark;

interface MainPerformanceChartProps {
  participants: Participant[];
}

const CustomTooltip = ({ active, payload, label, selectedParticipantId }: any) => {
  if (active && payload && payload.length) {
    const day = Math.floor(label);
    const hourDecimal = label - day;
    const hours = Math.floor(hourDecimal * 10);
    const minutes = Math.round((hourDecimal * 10 - hours) * 60);
    const timeLabel = hours === 0 && minutes === 0 ? `Day ${day}` : `Day ${day}, ${hours}:${minutes.toString().padStart(2, '0')}`;
    
    // If a participant is selected, only show that one; otherwise show all
    const filteredPayload = selectedParticipantId 
      ? payload.filter((pld: any) => pld.dataKey === selectedParticipantId)
      : payload;
    
    return (
      <div className="bg-arena-surface p-4 rounded-md border border-arena-border shadow-lg">
        <p className="label text-arena-text-primary font-semibold">{timeLabel}</p>
        <div className="mt-2 space-y-1">
          {filteredPayload.sort((a: any, b: any) => b.value - a.value).map((pld: any) => (
            <div key={pld.dataKey} style={{ color: pld.color }} className="text-sm flex justify-between space-x-4">
              <span>{pld.name}:</span>
              <span className="font-mono font-semibold">${pld.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

const EndOfLineLabel = ({ points, data, color, name, isBenchmark }: any) => {
  if (!points || points.length === 0 || !data || data.length === 0) return null;

  const lastPoint = points[points.length - 1];
  const { x, y } = lastPoint;
  const value = data[data.length - 1].totalValue;

  return (
    <g transform={`translate(${x + 8}, ${y - 10})`}>
      <rect
        height="22"
        width={name.length * 8 + 65}
        fill={color}
        rx="4"
        style={{ filter: `drop-shadow(0 1px 1px rgb(0 0 0 / 0.5))` }}
      />
      <text x="5" y="15" fill="#fff" fontSize="12px" fontWeight={isBenchmark ? "normal" : "bold"}>
        {name}
      </text>
      <text x={name.length * 8 + 5} y="15" fill="#fff" fontSize="12px" fontWeight="normal" opacity="0.8">
        ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </text>
    </g>
  );
};


export const MainPerformanceChart: React.FC<MainPerformanceChartProps> = ({ participants }) => {
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [hoveredParticipantId, setHoveredParticipantId] = useState<string | null>(null);
  
  const { chartData, yAxisDomain } = useMemo(() => {
    if (!participants.length || participants[0].performanceHistory.length === 0) {
      return { chartData: [], yAxisDomain: ['auto', 'auto'] };
    }
    
    // Filter participants based on selection
    const visibleParticipants = selectedParticipantId 
      ? participants.filter(p => p.id === selectedParticipantId)
      : participants;
    
    // Collect all unique timestamps (including intraday)
    const allTimestamps = new Set<number>();
    visibleParticipants.forEach(p => {
      p.performanceHistory.forEach(metric => {
        allTimestamps.add(metric.timestamp);
      });
    });
    
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    const data = [];
    let minValue = Infinity;
    let maxValue = -Infinity;

    sortedTimestamps.forEach(timestamp => {
      const dayData: { [key: string]: number | string } = { timestamp };
      visibleParticipants.forEach(p => {
        // Find the metric with this exact timestamp (or closest)
        const metric = p.performanceHistory.find(m => Math.abs(m.timestamp - timestamp) < 0.01) ||
                      p.performanceHistory.find(m => m.timestamp <= timestamp && !p.performanceHistory.find(m2 => m2.timestamp > m.timestamp && m2.timestamp <= timestamp));
        if (metric) {
          const value = metric.totalValue;
          dayData[p.id] = value;
          minValue = Math.min(minValue, value);
          maxValue = Math.max(maxValue, value);
        }
      });
      // Also include initial capital if no participant is selected
      if (!selectedParticipantId) {
        dayData['initial-capital'] = INITIAL_CASH;
        minValue = Math.min(minValue, INITIAL_CASH);
        maxValue = Math.max(maxValue, INITIAL_CASH);
      }
      data.push(dayData);
    });
    
    // Calculate domain with tighter padding to fit curves better
    const range = maxValue - minValue;
    const padding = Math.max(50, range * 0.05); // 5% padding or minimum $50 for very small ranges
    const domain: [number, number] = [
      Math.max(0, minValue - padding),
      maxValue + padding
    ];
    
    return { chartData: data, yAxisDomain: domain };
  }, [participants, selectedParticipantId]);

  if (chartData.length === 0) {
    return <div className="flex items-center justify-center h-full text-arena-text-secondary">Awaiting simulation data...</div>;
  }

  return (
    <div className="relative w-full h-full">
      {selectedParticipantId && (
        <div className="absolute top-2 right-2 z-10 bg-arena-surface px-3 py-1 rounded-md border border-arena-border text-xs text-arena-text-secondary">
          Showing: {participants.find(p => p.id === selectedParticipantId)?.name || 'Selected'}
          <span className="ml-2 text-arena-text-tertiary">(Click chart to show all)</span>
        </div>
      )}
      {!selectedParticipantId && (
        <div className="absolute top-2 right-2 z-10 bg-arena-surface px-3 py-1 rounded-md border border-arena-border text-xs text-arena-text-secondary">
          Hover to highlight • Click to focus
        </div>
      )}
    <ResponsiveContainer width="100%" height="100%" minHeight={200}>
      <LineChart
        data={chartData}
        margin={{ top: 15, right: 170, left: 10, bottom: 5 }}
        onClick={(e) => {
          // If clicking on chart background (not a line), deselect
          if (selectedParticipantId && !e?.activePayload?.length) {
            setSelectedParticipantId(null);
          }
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis 
          dataKey="timestamp" 
          stroke="#A3A3A3" 
          tick={{ fill: '#A3A3A3', fontSize: 12 }}
          tickFormatter={(value: number) => {
            const day = Math.floor(value);
            const hourDecimal = value - day;
            const hours = Math.floor(hourDecimal * 10);
            const minutes = Math.round((hourDecimal * 10 - hours) * 60);
            if (hours === 0 && minutes === 0) {
              return `Day ${day}`;
            } else {
              return `D${day} ${hours}:${minutes.toString().padStart(2, '0')}`;
            }
          }}
        />
        <YAxis
          stroke="#A3A3A3"
          tick={{ fill: '#A3A3A3', fontSize: 12 }}
          tickFormatter={(value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          domain={yAxisDomain}
          width={80}
        />
        <Tooltip content={<CustomTooltip selectedParticipantId={selectedParticipantId || hoveredParticipantId} />} />
        
        {/* Initial Capital line - only show if no participant is selected, or dimmed if hovering */}
        {!selectedParticipantId && (
          <Line 
              isAnimationActive={false}
              dataKey={() => INITIAL_CASH} 
              stroke="#737373" 
              strokeWidth={1.5} 
              strokeDasharray="5 5" 
              dot={false}
              name="Initial Capital"
              opacity={hoveredParticipantId ? 0.2 : 1}
          />
        )}

        {participants
          .filter(p => !selectedParticipantId || selectedParticipantId === p.id)
          .map(p => {
            const isHovered = hoveredParticipantId === p.id;
            const isSelected = selectedParticipantId === p.id;
            const opacity = selectedParticipantId && !isSelected ? 0 : (hoveredParticipantId && !isHovered ? 0.2 : 1);
            const strokeWidth = isHovered || isSelected 
              ? ((p as Benchmark).name === "AI Managers Index" ? 4 : 3)
              : ((p as Benchmark).name === "AI Managers Index" ? 3 : 2);
            
            return (
              <Line
                key={p.id}
                type="linear"
                dataKey={p.id}
                stroke={p.color}
                strokeWidth={strokeWidth}
                strokeDasharray={(p as Benchmark).name === "S&P 500" ? "3 3" : "0"}
                dot={false}
                activeDot={{ r: 6, strokeWidth: 2, stroke: p.color, fill: p.color, cursor: 'pointer' }}
                isAnimationActive={false}
                connectNulls={false}
                name={p.name}
                opacity={opacity}
                style={{ cursor: 'pointer', transition: 'opacity 0.2s, stroke-width 0.2s' }}
                onMouseEnter={() => setHoveredParticipantId(p.id)}
                onMouseLeave={() => setHoveredParticipantId(null)}
                onClick={(e) => {
                  e?.stopPropagation?.(); // Prevent chart background click
                  if (selectedParticipantId === p.id) {
                    setSelectedParticipantId(null); // Click again to deselect
                  } else {
                    setSelectedParticipantId(p.id); // Click to select
                  }
                }}
                label={<EndOfLineLabel data={p.performanceHistory} color={p.color} name={p.name} isBenchmark={(p as any).name.includes('Index') || (p as any).name.includes('S&P')} />}
              />
            );
          })}
      </LineChart>
    </ResponsiveContainer>
    </div>
  );
};