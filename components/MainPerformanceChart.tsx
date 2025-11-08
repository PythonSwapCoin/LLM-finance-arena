import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { Agent, Benchmark } from '../types';
import { INITIAL_CASH } from '../constants';

type Participant = Agent | Benchmark;

interface MainPerformanceChartProps {
  participants: Participant[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-arena-surface p-4 rounded-md border border-arena-border shadow-lg">
        <p className="label text-arena-text-primary font-semibold">{`Day ${label}`}</p>
        <div className="mt-2 space-y-1">
          {payload.sort((a,b) => b.value - a.value).map((pld: any) => (
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
  const chartData = useMemo(() => {
    if (!participants.length || participants[0].performanceHistory.length === 0) return [];
    
    const numDays = participants[0].performanceHistory.length;
    const data = [];

    for (let i = 0; i < numDays; i++) {
      const dayData: { [key: string]: number | string } = { timestamp: i };
      participants.forEach(p => {
        if (p.performanceHistory[i]) {
          dayData[p.id] = p.performanceHistory[i].totalValue;
        }
      });
      data.push(dayData);
    }
    return data;
  }, [participants]);

  if (chartData.length === 0) {
    return <div className="flex items-center justify-center h-full text-arena-text-secondary">Awaiting simulation data...</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={chartData}
        margin={{ top: 15, right: 170, left: 10, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis dataKey="timestamp" stroke="#A3A3A3" tick={{ fill: '#A3A3A3', fontSize: 12 }} />
        <YAxis
          stroke="#A3A3A3"
          tick={{ fill: '#A3A3A3', fontSize: 12 }}
          tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`}
          domain={['auto', 'auto']}
          width={50}
        />
        <Tooltip content={<CustomTooltip />} />
        
        <Line 
            isAnimationActive={false}
            dataKey={() => INITIAL_CASH} 
            stroke="#737373" 
            strokeWidth={1.5} 
            strokeDasharray="5 5" 
            dot={false}
            name="Initial Capital"
        />

        {participants.map(p => (
          <Line
            key={p.id}
            type="monotone"
            dataKey={p.id}
            stroke={p.color}
            strokeWidth={(p as Benchmark).name === "AI Managers Index" ? 3 : 2}
            strokeDasharray={(p as Benchmark).name === "S&P 500" ? "3 3" : "0"}
            dot={false}
            isAnimationActive={false}
            name={p.name}
            label={<EndOfLineLabel data={p.performanceHistory} color={p.color} name={p.name} isBenchmark={(p as any).name.includes('Index') || (p as any).name.includes('S&P')} />}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};