import { motion } from 'framer-motion';

const focusBlocks = [
  { time: '08:40', title: 'Deep work lagoon', meta: 'AI shields 96 min from noisy tasks', mood: 'calm' },
  { time: '11:15', title: 'Micro-errands merge', meta: 'Combines 4 tiny jobs into one route', mood: 'flow' },
  { time: '15:30', title: 'Recovery pocket', meta: 'Auto-created after cognitive overload', mood: 'soft' },
];

const novelFeatures = [
  'ChronoMorph — schedule reshapes itself like liquid when priorities collide.',
  'Energy Weather — predicts focus, fatigue, and social battery before tasks land.',
  'Anti-Procrastination Swarm — breaks a scary task into 7-minute starter droplets.',
  'Memory Hooks — attaches tasks to places, people, and evidence on the board.',
];

export function PlannerPanel() {
  return (
    <motion.aside
      className="planner-shell liquid-glass"
      initial={{ y: 34, opacity: 0, filter: 'blur(18px)' }}
      animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
      transition={{ delay: 0.25, duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
      aria-label="Liquid glass planning dashboard"
    >
      <div className="liquid-orb orb-a" aria-hidden />
      <div className="liquid-orb orb-b" aria-hidden />

      <header className="planner-hero">
        <span className="planner-kicker">LIQUID DAY OS</span>
        <h1>Планировщик, который течёт вместе с вашим днём</h1>
        <p>
          Распорядок собирается из живых стеклянных блоков: перетекает, меняет форму и сам
          находит лучшее окно для задач, отдыха и неожиданных идей.
        </p>
      </header>

      <section className="chrono-card" aria-label="Adaptive timeline preview">
        <div className="chrono-head">
          <span>Today Flow</span>
          <strong>83% синхронно</strong>
        </div>
        <div className="chrono-stream">
          {focusBlocks.map((block, index) => (
            <motion.article
              className={`flow-block ${block.mood}`}
              key={block.title}
              initial={{ x: 22, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.55 + index * 0.12, type: 'spring', stiffness: 160, damping: 18 }}
            >
              <time>{block.time}</time>
              <div>
                <b>{block.title}</b>
                <span>{block.meta}</span>
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="feature-grid" aria-label="Unique planning features">
        {novelFeatures.map((feature, index) => (
          <motion.div
            className="feature-chip"
            key={feature}
            whileHover={{ y: -4, scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            style={{ '--delay': `${index * 0.35}s` } as React.CSSProperties}
          >
            {feature}
          </motion.div>
        ))}
      </section>
    </motion.aside>
  );
}
