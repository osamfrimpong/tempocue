use serde::{Deserialize, Serialize};

pub const DEFAULT_DURATION_MS: i64 = 10 * 60 * 1000;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerState {
    pub id: String,
    pub mode: TimerMode,
    pub status: TimerStatus,
    pub duration_ms: i64,
    pub started_at_ms: Option<i64>,
    pub paused_at_ms: Option<i64>,
    pub accumulated_pause_ms: i64,
    pub remaining_at_pause_ms: Option<i64>,
    pub target_end_at_ms: Option<i64>,
    pub server_now_ms: i64,
    pub overtime_behavior: OvertimeBehavior,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TimerMode {
    Countdown,
    Countup,
    Clock,
    EndAtTime,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TimerStatus {
    Idle,
    Running,
    Paused,
    Finished,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OvertimeBehavior {
    Continue,
    Stop,
    Hide,
    AutoNext,
}

impl Default for TimerState {
    fn default() -> Self {
        Self::new(DEFAULT_DURATION_MS)
    }
}

impl TimerState {
    pub fn new(duration_ms: i64) -> Self {
        Self {
            id: "active".to_string(),
            mode: TimerMode::Countdown,
            status: TimerStatus::Idle,
            duration_ms,
            started_at_ms: None,
            paused_at_ms: None,
            accumulated_pause_ms: 0,
            remaining_at_pause_ms: None,
            target_end_at_ms: None,
            server_now_ms: now_ms(),
            overtime_behavior: OvertimeBehavior::Continue,
        }
    }

    pub fn start(&mut self) {
        let now = now_ms();
        if self.status == TimerStatus::Running {
            self.server_now_ms = now;
            return;
        }

        if self.status == TimerStatus::Paused {
            if let Some(paused_at_ms) = self.paused_at_ms {
                self.accumulated_pause_ms += now - paused_at_ms;
            }
            self.paused_at_ms = None;
            self.remaining_at_pause_ms = None;
            self.status = TimerStatus::Running;
            self.server_now_ms = now;
            return;
        }

        self.status = TimerStatus::Running;
        self.started_at_ms = Some(now);
        self.paused_at_ms = None;
        self.accumulated_pause_ms = 0;
        self.remaining_at_pause_ms = None;
        self.server_now_ms = now;
    }

    pub fn pause(&mut self) {
        if self.status != TimerStatus::Running {
            return;
        }

        let now = now_ms();
        let remaining_ms = self.remaining_ms(now);
        self.status = TimerStatus::Paused;
        self.paused_at_ms = Some(now);
        self.remaining_at_pause_ms = Some(remaining_ms);
        self.server_now_ms = now;
    }

    pub fn reset(&mut self) {
        if let TimerMode::EndAtTime = self.mode {
            self.status = TimerStatus::Idle;
            self.started_at_ms = None;
            self.paused_at_ms = None;
            self.accumulated_pause_ms = 0;
            self.remaining_at_pause_ms = None;
            if let Some(target_end_at_ms) = self.target_end_at_ms {
                self.duration_ms = (target_end_at_ms - now_ms()).max(0);
            }
            self.server_now_ms = now_ms();
            return;
        }

        *self = TimerState::new(self.duration_ms);
    }

    pub fn add_time(&mut self, delta_ms: i64) {
        self.duration_ms = (self.duration_ms + delta_ms).max(0);
        self.target_end_at_ms = self.target_end_at_ms.map(|value| value + delta_ms);
        if self.status == TimerStatus::Paused {
            self.remaining_at_pause_ms = self.remaining_at_pause_ms.map(|value| (value + delta_ms).max(0));
        }
        self.server_now_ms = now_ms();
    }

    pub fn set_duration(&mut self, duration_ms: i64) {
        self.mode = TimerMode::Countdown;
        self.duration_ms = duration_ms.max(0);
        self.target_end_at_ms = None;
        if self.status != TimerStatus::Running {
            self.remaining_at_pause_ms = Some(self.duration_ms);
        }
        self.server_now_ms = now_ms();
    }

    pub fn set_remaining(&mut self, remaining_ms: i64) {
        let now = now_ms();
        let remaining = remaining_ms.max(0).min(self.duration_ms);

        match self.mode {
            TimerMode::EndAtTime => {
                self.duration_ms = self.duration_ms.max(remaining);
                self.target_end_at_ms = Some(now + remaining);
                self.remaining_at_pause_ms = if self.status == TimerStatus::Paused {
                    Some(remaining)
                } else {
                    None
                };
            }
            TimerMode::Countdown => {
                if self.status == TimerStatus::Running {
                    self.started_at_ms = Some(now - (self.duration_ms - remaining));
                    self.accumulated_pause_ms = 0;
                    self.paused_at_ms = None;
                    self.remaining_at_pause_ms = None;
                } else {
                    if self.status == TimerStatus::Idle {
                        self.status = TimerStatus::Paused;
                        self.started_at_ms = Some(now - (self.duration_ms - remaining));
                        self.paused_at_ms = Some(now);
                        self.accumulated_pause_ms = 0;
                    }
                    self.remaining_at_pause_ms = Some(remaining);
                }
            }
            _ => {}
        }

        self.server_now_ms = now;
    }

    pub fn set_end_at_time(&mut self, target_time: &str) -> Result<(), String> {
        let target_end_at_ms = next_local_time_ms(target_time)?;
        let now = now_ms();
        self.mode = TimerMode::EndAtTime;
        self.status = TimerStatus::Running;
        self.duration_ms = (target_end_at_ms - now).max(0);
        self.started_at_ms = Some(now);
        self.paused_at_ms = None;
        self.accumulated_pause_ms = 0;
        self.remaining_at_pause_ms = None;
        self.target_end_at_ms = Some(target_end_at_ms);
        self.server_now_ms = now;
        Ok(())
    }

    pub fn configure_end_at_time(&mut self, target_time: &str) -> Result<(), String> {
        let target_end_at_ms = next_local_time_ms(target_time)?;
        let now = now_ms();
        self.mode = TimerMode::EndAtTime;
        self.status = TimerStatus::Idle;
        self.duration_ms = (target_end_at_ms - now).max(0);
        self.started_at_ms = None;
        self.paused_at_ms = None;
        self.accumulated_pause_ms = 0;
        self.remaining_at_pause_ms = None;
        self.target_end_at_ms = Some(target_end_at_ms);
        self.server_now_ms = now;
        Ok(())
    }

    pub fn touch_server_now(&mut self) {
        self.server_now_ms = now_ms();
    }

    fn remaining_ms(&self, now: i64) -> i64 {
        if self.status == TimerStatus::Idle {
            return self.duration_ms;
        }
        if let TimerMode::EndAtTime = self.mode {
            if self.status == TimerStatus::Paused {
                return self.remaining_at_pause_ms.unwrap_or(self.duration_ms);
            }
            if let Some(target_end_at_ms) = self.target_end_at_ms {
                return (target_end_at_ms - now).max(0);
            }
        }
        if self.status == TimerStatus::Paused {
            return self.remaining_at_pause_ms.unwrap_or(self.duration_ms);
        }
        let Some(started_at_ms) = self.started_at_ms else {
            return self.duration_ms;
        };
        let elapsed = now - started_at_ms - self.accumulated_pause_ms;
        match self.mode {
            TimerMode::Countup => elapsed,
            _ => (self.duration_ms - elapsed).max(0),
        }
    }
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn next_local_time_ms(target_time: &str) -> Result<i64, String> {
    use chrono::{Duration, Local, NaiveTime, TimeZone};

    let parsed = NaiveTime::parse_from_str(target_time, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(target_time, "%H:%M:%S"))
        .map_err(|_| "Target time must use HH:MM format".to_string())?;

    let now = Local::now();
    let today = now.date_naive();
    let target_naive = today.and_time(parsed);
    let mut target = Local
        .from_local_datetime(&target_naive)
        .single()
        .ok_or_else(|| "Target time is ambiguous in the server timezone".to_string())?;

    if target <= now {
        let tomorrow_naive = (today + Duration::days(1)).and_time(parsed);
        target = Local
            .from_local_datetime(&tomorrow_naive)
            .single()
            .ok_or_else(|| "Target time is ambiguous in the server timezone".to_string())?;
    }

    Ok(target.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_preserves_current_countdown_remaining_time() {
        let now = now_ms();
        let mut timer = TimerState::new(10 * 60 * 1000);
        timer.status = TimerStatus::Running;
        timer.started_at_ms = Some(now - 30 * 1000);

        timer.pause();

        let remaining = timer.remaining_at_pause_ms.expect("pause should store remaining time");
        assert_eq!(timer.status, TimerStatus::Paused);
        assert!(remaining <= timer.duration_ms - 25 * 1000);
        assert!(remaining > timer.duration_ms - 35 * 1000);
    }

    #[test]
    fn idle_end_at_time_keeps_configured_duration_remaining() {
        let mut timer = TimerState::new(10 * 60 * 1000);
        timer.mode = TimerMode::EndAtTime;
        timer.status = TimerStatus::Idle;
        timer.target_end_at_ms = Some(now_ms() + 60 * 60 * 1000);

        assert_eq!(timer.remaining_ms(now_ms() + 30 * 1000), timer.duration_ms);
    }

    #[test]
    fn countdown_remaining_stops_at_zero() {
        let now = now_ms();
        let mut timer = TimerState::new(10 * 1000);
        timer.status = TimerStatus::Running;
        timer.started_at_ms = Some(now - 15 * 1000);

        assert_eq!(timer.remaining_ms(now), 0);
    }

    #[test]
    fn end_at_time_remaining_stops_at_zero() {
        let now = now_ms();
        let mut timer = TimerState::new(10 * 1000);
        timer.mode = TimerMode::EndAtTime;
        timer.status = TimerStatus::Running;
        timer.target_end_at_ms = Some(now - 5 * 1000);

        assert_eq!(timer.remaining_ms(now), 0);
    }

    #[test]
    fn countup_can_continue_past_duration() {
        let now = now_ms();
        let mut timer = TimerState::new(10 * 1000);
        timer.mode = TimerMode::Countup;
        timer.status = TimerStatus::Running;
        timer.started_at_ms = Some(now - 15 * 1000);

        assert_eq!(timer.remaining_ms(now), 15 * 1000);
    }
}
