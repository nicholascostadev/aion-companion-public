#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod activities;
mod activity_window;
mod alert_window;
mod alerts;
mod background;
mod backup_dialog;
mod backup_store;
mod backups;
mod build_info;
mod capture_commands;
mod crash;
mod cubes;
mod diagnostics;
mod finder_preferences;
mod focus;
mod gathering;
mod github_cli;
mod group_auto;
mod group_window;
mod hit;
mod instance;
mod map_art;
mod no_activate;
mod offline;
mod overlay;
mod overlay_locks;
mod pet_window;
mod pets;
mod recordings;
mod server_status;
mod setup;
mod ui_preferences;
mod update_access;
mod updates;
mod webview_visibility;
mod window_positions;
use companion_capture::LiveCapture;
use tauri::Manager;

fn main() {
    diagnostics::install_panic_hook();
    backups::await_previous_process().expect("Could not complete recovery restart");
    let _instance = instance::Guard::acquire().expect("Could not start Aion Companion");
    crash::install();
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("map-art", |context, request, responder| {
            map_art::protocol(context.app_handle().clone(), request, responder)
        })
        .on_window_event(overlay::window_event)
        .manage(LiveCapture::default())
        .manage(recordings::Session::default())
        .manage(updates::UpdatesState::default())
        .manage(update_access::UpdateAccessState::default())
        .manage(backups::BackupsState::default())
        .manage(overlay::OverlayState::default())
        .manage(ui_preferences::NativeUi::default())
        .manage(map_art::MapArtState::default())
        .setup(|app| {
            build_info::initialize(app.handle()).map_err(std::io::Error::other)?;
            diagnostics::initialize(app.handle());
            let root = backups::root(app.handle()).map_err(std::io::Error::other)?;
            let recovery =
                backup_store::begin(&root, backups::channel()).map_err(std::io::Error::other)?;
            let initialized = (|| -> Result<(), Box<dyn std::error::Error>> {
                offline::initialize(app.handle()).map_err(std::io::Error::other)?;
                overlay_locks::setup(app.handle()).map_err(std::io::Error::other)?;
                finder_preferences::setup(app.handle()).map_err(std::io::Error::other)?;
                window_positions::setup(app.handle()).map_err(std::io::Error::other)?;
                activity_window::setup(app.handle()).map_err(std::io::Error::other)?;
                overlay::setup(app.handle())?;
                ui_preferences::refresh(app.handle()).map_err(std::io::Error::other)?;
                alert_window::setup(app.handle()).map_err(std::io::Error::other)?;
                pet_window::setup(app.handle()).map_err(std::io::Error::other)?;
                activity_window::startup(app.handle());
                Ok(())
            })();
            if let Some(recovery) = &recovery {
                backup_store::finish(&root, recovery, initialized.is_ok())
                    .map_err(std::io::Error::other)?;
            }
            initialized?;
            app.state::<LiveCapture>()
                .start_automatic()
                .map_err(std::io::Error::other)?;
            alerts::start(app.handle());
            server_status::start(app.handle());
            updates::setup(app.handle());
            instance::setup_quit_signal(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            setup::setup_status,
            setup::setup_open_link,
            backups::backups_status,
            backups::backups_plan,
            backups::backups_export,
            backups::backups_preview,
            backups::backups_cancel,
            backups::backups_restore,
            ui_preferences::ui_preferences,
            finder_preferences::finder_preferences,
            finder_preferences::finder_preferences_update,
            activities::timers_status,
            activity_window::activity_window_status,
            activity_window::activity_window_ready,
            activity_window::activity_window_show,
            activity_window::activity_window_hide,
            activity_window::activity_window_lock,
            activity_window::activity_window_hit_regions,
            build_info::app_build_info,
            diagnostics::diagnostics_export,
            diagnostics::diagnostics_record,
            updates::updates_status,
            update_access::updates_access_status,
            update_access::updates_access_check,
            update_access::updates_access_login,
            updates::updates_check,
            updates::updates_download,
            updates::updates_install,
            pet_window::pets_overlay_status,
            pet_window::pets_overlay_ready,
            pet_window::pets_overlay_show,
            pet_window::pets_overlay_hide,
            pet_window::pets_overlay_lock,
            pet_window::pets_overlay_hit_regions,
            pets::pets_catalogue,
            map_art::map_art_status,
            map_art::map_art_ensure,
            pets::pets_status,
            pets::pets_motion,
            pets::pets_configure,
            cubes::cubes_status,
            cubes::cubes_clear,
            gathering::gathering_status,
            recordings::demo,
            recordings::snapshot,
            recordings::import_recording,
            recordings::save_recording,
            capture_commands::live_status,
            capture_commands::group_status,
            capture_commands::live_reset,
            recordings::load_live_recording,
            capture_commands::live_configure,
            capture_commands::save_live_comparison,
            overlay::overlay_status,
            overlay::overlay_ready,
            overlay::menu_ready,
            overlay::menu_show,
            overlay::group_ready,
            overlay::group_show,
            overlay::group_hide,
            group_window::group_fit,
            overlay::overlay_lock,
            overlay::overlay_show,
            overlay::overlay_hide,
            overlay::overlay_workspace,
            overlay::overlay_quit,
            overlay::trackers_ready,
            overlay::trackers_show,
            overlay::trackers_hide,
            overlay::trackers_arrange,
            overlay::details_ready,
            overlay::details_open,
            overlay::details_hide,
            overlay::overlay_hit_regions,
            no_activate::overlay_take_keyboard,
            offline::offline_inspect,
            offline::offline_status,
            offline::offline_live_status,
            offline::offline_configure,
            offline::offline_logs,
            offline::offline_log,
            offline::offline_log_rename,
            offline::offline_log_delete,
            offline::offline_export,
            offline::offline_catalogue_import,
            offline::offline_summary,
            offline::offline_action,
            offline::offline_positions,
            offline::offline_copy_text,
            alerts::alerts_status,
            alerts::alerts_configure,
            alerts::alerts_action,
            alerts::alerts_test,
            alert_window::alerts_popup_ready,
            alert_window::alerts_popup_dismiss
        ])
        .build(tauri::generate_context!())
        .expect("Unable to start companion")
        .run(|_, event| match event {
            tauri::RunEvent::ExitRequested { code, .. } => crash::exit_requested(code),
            tauri::RunEvent::Exit => crash::finish(),
            _ => {}
        });
}
